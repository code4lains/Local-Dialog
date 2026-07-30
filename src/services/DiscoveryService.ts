import axios from 'axios';
import peerService from './PeerService';
import { useStore } from '../store/useStore';


/**
 * 简单的字符串哈希函数，将 IP 转换为较短的固定字符串
 */
async function hashString(message: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  return hashHex.substring(0, 12); // 取前 12 位即可
}

class DiscoveryService {
  private isDiscovering = false;

  /**
   * 尝试基于公网 IP 自动发现局域网内的设备
   * 策略：
   * 1. 获取公网 IP，计算其 Hash，生成 `lobby-{hash}-host`。
   * 2. 尝试作为客户端连接该 host。
   * 3. 如果连接失败（说明当前网络还没有 host），则自己注册成为 `lobby-{hash}-host`。
   * 4. 如果连接成功，对方就是同局域网内的设备！
   */
  async autoDiscover() {
    if (this.isDiscovering) return;
    this.isDiscovering = true;
    try {
      console.log('正在获取公网 IP 用于局域网发现...');
      const response = await axios.get('https://api.ipify.org?format=json');
      const ip = response.data.ip;
      console.log('当前公网 IP:', ip);

      const ipHash = await hashString(ip);
      const lobbyHostId = `local-drop-lobby-${ipHash}`;

      // 1. 先初始化自己的随机 PeerID
      await peerService.initialize();

      // 2. 尝试向大厅的主机发送探测 (Ping)
      console.log(`尝试寻找同局域网内的主机: ${lobbyHostId}`);
      try {
        const hostName = await peerService.ping(lobbyHostId);
        console.log(`成功探测到同局域网内的主机: ${hostName}！`);
        // 探测成功，对方会在被 ping 的同时将我们加入它的列表
        // 我们也把大厅主机加入我们的发现列表
        useStore.getState().addDiscoveredPeer(lobbyHostId, hostName);
      } catch (err) {
        // 连接失败说明大厅主机不存在，当前设备需要成为大厅主机
        console.log('未找到已存在的主机，当前设备将作为大厅主机...');
        await peerService.initialize(lobbyHostId);
      }
    } catch (error) {
      console.error('自动发现失败 (无法获取IP等):', error);
      // 降级为普通的随机 ID 初始化
      await peerService.initialize();
    } finally {
      this.isDiscovering = false;
    }
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
}

export default new DiscoveryService();
