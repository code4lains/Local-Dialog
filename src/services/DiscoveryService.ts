import axios from 'axios';
import Peer from 'peerjs';
import peerService from './PeerService';
import { useStore } from '../store/useStore';

// PeerJS doesn't export DataConnection directly, so we infer the type
type DataConnection = ReturnType<InstanceType<typeof Peer>['connect']>;


/**
 * 简单的字符串哈希函数，将字符串转换为较短的固定哈希
 */
async function hashString(message: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  return hashHex.substring(0, 12); // 取前 12 位
}

/**
 * 尝试通过多个提供商并发/降级获取公网 IP
 */
async function fetchPublicIp(): Promise<string | null> {
  const providers = [
    'https://api.ipify.org?format=json',
    'https://api64.ipify.org?format=json',
    'https://ipapi.co/json/'
  ];

  for (const url of providers) {
    try {
      const res = await axios.get(url, { timeout: 3000 });
      if (res.data && res.data.ip) {
        return String(res.data.ip).trim();
      }
    } catch {
      // 尝试下一个接口
    }
  }
  return null;
}

interface RegisteredPeer {
  peerId: string;
  deviceName: string;
  lastSeen: number;
}

/**
 * 大厅发现服务
 * 
 * 核心思路：
 * - 每台设备用随机 ID 初始化 PeerJS（只初始化一次，永不覆盖）
 * - 基于公网 IP Hash 与可选房间/频道密钥计算固定的 "大厅 Peer ID"
 * - 第一台设备会额外创建一个 Peer 实例作为大厅主机（不影响自己的主 Peer）
 * - 后来的设备连接到大厅主机，注册自己的 Peer ID
 * - 大厅主机维护在线设备列表，并广播给所有已注册的设备
 * - 如果大厅主机掉线，其他设备自动竞争成为新的大厅主机
 */
class DiscoveryService {
  private isDiscovering = false;
  private lobbyPeer: Peer | null = null; // 当前设备作为大厅主机时的额外 Peer 实例
  private lobbyHostId: string | null = null;
  private registeredPeers: Map<string, RegisteredPeer> = new Map(); // 大厅主机维护的注册表
  private lobbyConnections: Map<string, DataConnection> = new Map(); // 大厅主机到各客户端的连接
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lobbyConnection: DataConnection | null = null; // 作为客户端连接到大厅主机的连接
  private ipHash: string | null = null;

  // PeerJS 配置
  private peerConfig = {
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' }
      ]
    }
  };

  /**
   * 获取自定义频道/群组密钥（解决大内网/校园网/CGNAT冲突）
   */
  getChannelKey(): string {
    return localStorage.getItem('local_dialog_channel') || '';
  }

  /**
   * 设置自定义频道密钥并重新发现
   */
  async setChannelKey(channel: string) {
    localStorage.setItem('local_dialog_channel', channel.trim());
    this.destroy();
    await this.autoDiscover();
  }

  /**
   * 尝试基于公网 IP 与频道设置自动发现局域网内的设备
   */
  async autoDiscover() {
    if (this.isDiscovering) return;
    this.isDiscovering = true;
    try {
      console.log('[Discovery] 正在获取网络出口信息用于局域网发现...');
      const ip = await fetchPublicIp();
      const channel = this.getChannelKey();
      const channelSuffix = channel ? `-${await hashString(channel)}` : '';

      if (ip) {
        console.log('[Discovery] 当前公网 IP:', ip);
        this.ipHash = await hashString(ip);
        this.lobbyHostId = `local-drop-lobby-${this.ipHash}${channelSuffix}`;
      } else {
        console.warn('[Discovery] 未检测到公网出口 IP（离线内网或连接超时），使用本地内网频道');
        this.lobbyHostId = `local-drop-lobby-offline${channelSuffix}`;
      }

      console.log(`[Discovery] 目标大厅主机 ID: ${this.lobbyHostId}`);

      // 1. 先初始化自己的随机 PeerID（这是唯一一次初始化，后续不会覆盖）
      await peerService.initialize();
      const myPeerId = useStore.getState().localPeerId;
      console.log(`[Discovery] 我的 Peer ID: ${myPeerId}`);

      // 2. 尝试作为客户端连接到大厅主机
      const connected = await this.tryJoinLobby();
      if (!connected) {
        // 3. 大厅主机不存在，自己成为大厅主机
        console.log('[Discovery] 未找到大厅主机，当前设备将承担大厅主机职责...');
        await this.becomeLobbyHost();
      }

      // 4. 启动心跳
      this.startHeartbeat();

    } catch (error) {
      console.error('[Discovery] 自动发现失败:', error);
      // 降级为普通的随机 ID 初始化（如果还没初始化过）
      if (!useStore.getState().localPeerId) {
        await peerService.initialize();
      }
    } finally {
      this.isDiscovering = false;
    }
  }

  /**
   * 尝试连接到大厅主机
   */
  private tryJoinLobby(): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.lobbyHostId) return resolve(false);

      const mainPeer = peerService.getPeer();
      if (!mainPeer) return resolve(false);

      const myPeerId = useStore.getState().localPeerId;
      const myDeviceName = useStore.getState().localDeviceName;

      console.log(`[Discovery] 尝试连接到大厅主机: ${this.lobbyHostId}`);

      const conn = mainPeer.connect(this.lobbyHostId, {
        reliable: true,
        metadata: {
          type: 'lobby-register',
          peerId: myPeerId,
          deviceName: myDeviceName,
        }
      });

      let settled = false;

      // 监听 peer-unavailable 错误
      const onPeerError = (e: any) => {
        const err = e.detail;
        if (err && err.type === 'peer-unavailable' && err.message?.includes(this.lobbyHostId)) {
          cleanup();
          if (!settled) {
            settled = true;
            resolve(false);
          }
        }
      };
      window.addEventListener('peer-error', onPeerError);

      const cleanup = () => {
        window.removeEventListener('peer-error', onPeerError);
      };

      conn.on('open', () => {
        cleanup();
        if (settled) return;
        settled = true;
        console.log('[Discovery] 成功连接到大厅主机！');
        this.lobbyConnection = conn;

        // 发送注册消息
        conn.send({
          type: 'lobby-register',
          peerId: myPeerId,
          deviceName: myDeviceName,
        });

        // 监听大厅广播
        conn.on('data', (data: any) => {
          this.handleLobbyMessage(data);
        });

        conn.on('close', () => {
          console.log('[Discovery] 与大厅主机断开连接，尝试接管...');
          this.lobbyConnection = null;
          // 延迟一点时间后尝试接管大厅
          setTimeout(() => this.tryTakeOverLobby(), 1000 + Math.random() * 2000);
        });

        resolve(true);
      });

      conn.on('error', () => {
        cleanup();
        if (!settled) {
          settled = true;
          resolve(false);
        }
      });

      // 超时
      setTimeout(() => {
        cleanup();
        if (!settled) {
          settled = true;
          resolve(false);
        }
      }, 5000);
    });
  }

  /**
   * 成为大厅主机
   */
  private becomeLobbyHost(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.lobbyHostId) return reject(new Error('No lobby host ID'));

      // 销毁旧的大厅 Peer（如果有）
      if (this.lobbyPeer) {
        this.lobbyPeer.destroy();
        this.lobbyPeer = null;
      }

      console.log(`[Discovery] 正在创建大厅主机 Peer: ${this.lobbyHostId}`);
      const lobbyPeer = new Peer(this.lobbyHostId, this.peerConfig);
      this.lobbyPeer = lobbyPeer;

      lobbyPeer.on('open', () => {
        console.log('[Discovery] 大厅主机已上线！');

        // 把自己注册到大厅
        const myPeerId = useStore.getState().localPeerId;
        const myDeviceName = useStore.getState().localDeviceName;
        if (myPeerId) {
          this.registeredPeers.set(myPeerId, {
            peerId: myPeerId,
            deviceName: myDeviceName,
            lastSeen: Date.now(),
          });
        }

        resolve();
      });

      // 当有设备连接到大厅
      lobbyPeer.on('connection', (conn) => {
        console.log(`[Discovery] 大厅收到新设备连接: ${conn.peer}`);

        conn.on('data', (data: any) => {
          if (data && data.type === 'lobby-register') {
            // 注册新设备
            const peerId = data.peerId as string;
            const deviceName = data.deviceName as string;
            console.log(`[Discovery] 注册新设备: ${peerId} (${deviceName})`);

            this.registeredPeers.set(peerId, {
              peerId,
              deviceName,
              lastSeen: Date.now(),
            });

            // 保存连接以便后续广播
            this.lobbyConnections.set(peerId, conn);

            // 立即广播更新后的设备列表给所有已连接的设备
            this.broadcastPeerList();
          } else if (data && data.type === 'lobby-heartbeat') {
            // 更新心跳时间
            const peerId = data.peerId as string;
            const existing = this.registeredPeers.get(peerId);
            if (existing) {
              existing.lastSeen = Date.now();
            }
          }
        });

        conn.on('close', () => {
          // 设备离开，从注册表移除
          const peerId = this.findPeerIdByConnection(conn);
          if (peerId) {
            console.log(`[Discovery] 设备离开: ${peerId}`);
            this.registeredPeers.delete(peerId);
            this.lobbyConnections.delete(peerId);
            this.broadcastPeerList();
          }
        });

        conn.on('error', (err) => {
          console.warn(`[Discovery] 大厅客户端连接异常 (${conn.peer}):`, err);
        });
      });

      lobbyPeer.on('error', (err: any) => {
        if (err && err.type === 'unavailable-id') {
          console.log('[Discovery] 大厅主机 ID 已被占用，尝试加入...');
          this.lobbyPeer = null;
          lobbyPeer.destroy();
          // 再尝试一次加入
          setTimeout(async () => {
            const joined = await this.tryJoinLobby();
            if (joined) {
              resolve();
            } else {
              resolve(); // 降级，不阻塞
            }
          }, 1000);
        } else {
          console.error('[Discovery] 大厅主机错误:', err);
          this.lobbyPeer = null;
          try {
            lobbyPeer.destroy();
          } catch {}
          reject(err);
        }
      });

      lobbyPeer.on('disconnected', () => {
        // 尝试重连
        if (this.lobbyPeer === lobbyPeer && !lobbyPeer.destroyed) {
          console.log('[Discovery] 大厅主机断线，尝试重连...');
          lobbyPeer.reconnect();
        }
      });
    });
  }

  /**
   * 在大厅主机失联后尝试接管
   */
  private async tryTakeOverLobby() {
    if (this.lobbyPeer) return; // 自己就是大厅主机，无需接管

    console.log('[Discovery] 尝试接管大厅主机...');
    
    // 先尝试连接，可能已经有别的设备接管了
    const joined = await this.tryJoinLobby();
    if (!joined) {
      // 没人接管，自己来
      try {
        await this.becomeLobbyHost();
      } catch (err) {
        console.error('[Discovery] 接管大厅失败:', err);
      }
    }
  }

  /**
   * 广播设备列表给所有已注册的设备
   */
  private broadcastPeerList() {
    const peerList = Array.from(this.registeredPeers.values());

    console.log(`[Discovery] 广播设备列表 (${peerList.length} 台设备)`);

    // 更新自己（大厅主机）的设备发现列表
    this.updateLocalDiscoveryList(peerList);

    // 广播给所有已连接的客户端
    const message = {
      type: 'lobby-peer-list',
      peers: peerList,
    };

    for (const [peerId, conn] of this.lobbyConnections.entries()) {
      try {
        if (conn.open) {
          conn.send(message);
        } else {
          // 连接已关闭，清理
          this.lobbyConnections.delete(peerId);
          this.registeredPeers.delete(peerId);
        }
      } catch (err) {
        console.error(`[Discovery] 向 ${peerId} 广播失败:`, err);
      }
    }
  }

  /**
   * 处理来自大厅的消息
   */
  private handleLobbyMessage(data: any) {
    if (!data || !data.type) return;

    if (data.type === 'lobby-peer-list') {
      const peers = data.peers as RegisteredPeer[];
      console.log(`[Discovery] 收到大厅设备列表更新: ${peers.length} 台设备`);
      this.updateLocalDiscoveryList(peers);
    }
  }

  /**
   * 更新本地设备发现列表
   */
  private updateLocalDiscoveryList(peers: RegisteredPeer[]) {
    const myPeerId = useStore.getState().localPeerId;
    const store = useStore.getState();

    for (const peer of peers) {
      // 不要把自己加到列表里
      if (peer.peerId === myPeerId) continue;
      store.addDiscoveredPeer(peer.peerId, peer.deviceName);
    }

    // 清理不在列表中的设备（除了当前已连接的设备）
    const remotePeerId = store.remotePeerId;
    const activePeerIds = new Set(peers.map(p => p.peerId));
    const currentPeers = store.discoveredPeers;
    const stalePeers = currentPeers.filter(
      p => p.id !== myPeerId && p.id !== remotePeerId && !activePeerIds.has(p.id)
    );
    if (stalePeers.length > 0) {
      store.removeDiscoveredPeers(stalePeers.map(p => p.id));
    }
  }

  /**
   * 根据连接反查 peerId
   */
  private findPeerIdByConnection(conn: DataConnection): string | null {
    for (const [peerId, c] of this.lobbyConnections.entries()) {
      if (c === conn) return peerId;
    }
    return null;
  }

  /**
   * 心跳：定期向大厅发送心跳，清理过期设备
   */
  private startHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);

    this.heartbeatTimer = setInterval(() => {
      const myPeerId = useStore.getState().localPeerId;

      // 如果自己是大厅主机
      if (this.lobbyPeer && !this.lobbyPeer.destroyed) {
        // 清理超过 30 秒没有心跳的设备
        const now = Date.now();
        let changed = false;
        for (const [peerId, peer] of this.registeredPeers.entries()) {
          // 不清理自己
          if (peerId === myPeerId) {
            peer.lastSeen = now;
            continue;
          }
          if (now - peer.lastSeen > 30000) {
            console.log(`[Discovery] 设备 ${peerId} 心跳超时，移除`);
            this.registeredPeers.delete(peerId);
            const conn = this.lobbyConnections.get(peerId);
            if (conn) {
              try { conn.close(); } catch {}
              this.lobbyConnections.delete(peerId);
            }
            changed = true;
          }
        }
        if (changed) {
          this.broadcastPeerList();
        }
      }

      // 如果自己是客户端，向大厅发送心跳
      if (this.lobbyConnection && this.lobbyConnection.open) {
        this.lobbyConnection.send({
          type: 'lobby-heartbeat',
          peerId: myPeerId,
        });
      }
    }, 10000); // 每 10 秒
  }

  /**
   * 生成专属房间 ID (Fallback)
   */
  generateRoomId(): string {
    return 'room-' + Math.random().toString(36).substring(2, 9);
  }

  /**
   * 处理 URL 中带有 ?room= 的逻辑
   */
  async checkUrlAndConnect() {
    const urlParams = new URLSearchParams(window.location.search);
    const roomId = urlParams.get('room');

    if (roomId) {
      console.log(`检测到专属房间参数: ${roomId}，正在尝试连接...`);
      // 初始化自己为随机 ID
      await peerService.initialize();
      
      try {
        await peerService.connect(roomId);
        console.log(`已发送连接请求到房间: ${roomId}`);
      } catch (err) {
        console.error(`无法连接到房间 ${roomId}:`, err);
        alert('无法连接到专属房间，可能房间已关闭。');
      }
      return true; // 表示拦截了启动逻辑
    }
    
    return false;
  }

  /**
   * 清理资源
   */
  destroy() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.lobbyConnection) {
      try { this.lobbyConnection.close(); } catch {}
      this.lobbyConnection = null;
    }
    for (const conn of this.lobbyConnections.values()) {
      try { conn.close(); } catch {}
    }
    this.lobbyConnections.clear();
    this.registeredPeers.clear();
    if (this.lobbyPeer) {
      this.lobbyPeer.destroy();
      this.lobbyPeer = null;
    }
  }
}

export default new DiscoveryService();
