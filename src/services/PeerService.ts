import Peer from 'peerjs';
import { useStore } from '../store/useStore';

interface FileMeta {
  id: string;
  type: 'file-meta';
  fileName: string;
  fileSize: number;
  totalChunks: number;
  mimeType: string;
  timestamp: number;
}

interface FileChunk {
  id: string;
  type: 'file-chunk';
  index: number;
  data: ArrayBuffer;
}

class PeerService {
  private peer: Peer | null = null;
  private connection: any | null = null;
  // 记录正在接收的文件块
  private incomingFiles: Record<string, { meta: FileMeta, chunks: ArrayBuffer[], received: number }> = {};

  initialize(id?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      if (this.peer) {
        const oldPeer = this.peer;
        this.peer = null;
        oldPeer.destroy();
      }

      const config = {
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' }
          ]
        }
      };

      const currentPeer = id ? new Peer(id, config) : new Peer(config);
      this.peer = currentPeer;

      currentPeer.on('open', (peerId) => {
        console.log('当前设备的 Peer ID 是: ' + peerId);
        useStore.getState().setLocalPeerId(peerId);
        resolve(peerId);
      });

      currentPeer.on('connection', (conn) => {
        if (this.connection && this.connection.open) {
          console.warn('已有活动连接，拒绝新连接');
          conn.close();
          return;
        }
        useStore.getState().setPendingConnection(conn);
      });

      currentPeer.on('disconnected', () => {
        useStore.getState().setConnectionStatus('disconnected');
        useStore.getState().setRemotePeerId(null);
        // 只对当前存活的 Peer 实例尝试重连
        if (this.peer === currentPeer && !currentPeer.destroyed) {
          currentPeer.reconnect();
        }
      });

      currentPeer.on('error', (err: any) => {
        // 'peer-unavailable' 是我们在自动发现中尝试连接不存在的大厅时的预期错误
        if (err && err.type === 'peer-unavailable') {
          console.log(`目标 Peer 不存在: ${err.message || '未知'}`);
          // 对于 peer-unavailable 不做 console.error 的吓人红字报错
        } else {
          console.error('PeerJS 发生错误:', err);
        }
        
        // 传递给当前正在等待初始化的 promise (如果是初始化阶段的错误)
        reject(err);

        // 如果我们正处于 connect() 阶段，需要触发全局状态来拒绝挂起的 connect promise
        // 由于 PeerJS 的 peer-unavailable 触发在 peer 级别而不是 connection 级别
        // 这里需要一个小 Hack，在全局触发一个事件
        const event = new CustomEvent('peer-error', { detail: err });
        window.dispatchEvent(event);
      });
    });
  }

  acceptConnection(conn: any) {
    this.setupConnection(conn);
    useStore.getState().setPendingConnection(null);
  }

  rejectConnection(conn: any) {
    conn.close();
    useStore.getState().setPendingConnection(null);
  }

  connect(remotePeerId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.peer) return reject(new Error('PeerJS 未初始化'));

      useStore.getState().setConnectionStatus('connecting');
      const conn = this.peer.connect(remotePeerId, { reliable: true });
      
      const onPeerError = (e: any) => {
        const err = e.detail;
        if (err && err.type === 'peer-unavailable' && err.message.includes(remotePeerId)) {
          cleanup();
          useStore.getState().setConnectionStatus('disconnected');
          reject(err);
        }
      };
      window.addEventListener('peer-error', onPeerError);

      const cleanup = () => {
        window.removeEventListener('peer-error', onPeerError);
      };

      conn.on('open', () => {
        cleanup();
        this.setupConnection(conn);
        resolve();
      });

      conn.on('error', (err) => {
        cleanup();
        useStore.getState().setConnectionStatus('disconnected');
        reject(err);
      });
      
      // Fallback timeout in case neither open nor error triggers
      setTimeout(() => {
        cleanup();
        if (!this.connection || !this.connection.open) {
          reject(new Error('Connection timeout'));
        }
      }, 10000);
    });
  }

  private setupConnection(conn: any) {
    this.connection = conn;
    
    useStore.getState().setConnectionStatus('connected');
    useStore.getState().setRemotePeerId(conn.peer);
    useStore.getState().addDiscoveredPeer(conn.peer);

    conn.on('data', (data: any) => {
      this.handleIncomingData(data, conn.peer);
    });

    conn.on('close', () => {
      useStore.getState().setConnectionStatus('disconnected');
      useStore.getState().setRemotePeerId(null);
      this.connection = null;
    });

    conn.on('error', (err: any) => {
      useStore.getState().setConnectionStatus('disconnected');
      this.connection = null;
    });
  }

  private handleIncomingData(data: any, senderId: string) {
    if (!data || !data.type) return;

    if (data.type === 'text') {
      useStore.getState().addMessage({
        id: data.id || crypto.randomUUID(),
        senderId,
        type: 'text',
        content: data.content,
        timestamp: data.timestamp || Date.now(),
        isSelf: false,
      });
    } else if (data.type === 'file-meta') {
      const meta = data as FileMeta;
      this.incomingFiles[meta.id] = { meta, chunks: new Array(meta.totalChunks), received: 0 };
      
      useStore.getState().addMessage({
        id: meta.id,
        senderId,
        type: 'file',
        fileName: meta.fileName,
        fileSize: meta.fileSize,
        mimeType: meta.mimeType,
        timestamp: meta.timestamp,
        progress: 0,
        isSelf: false,
      });
    } else if (data.type === 'file-chunk') {
      const chunk = data as FileChunk;
      const fileState = this.incomingFiles[chunk.id];
      if (!fileState) return;

      fileState.chunks[chunk.index] = chunk.data;
      fileState.received++;

      const progress = Math.floor((fileState.received / fileState.meta.totalChunks) * 100);
      useStore.getState().updateMessageProgress(chunk.id, progress);

      // 全部接收完毕，组装 Blob
      if (fileState.received === fileState.meta.totalChunks) {
        const blob = new Blob(fileState.chunks, { type: fileState.meta.mimeType });
        const url = URL.createObjectURL(blob);
        useStore.getState().updateMessageFileUrl(chunk.id, url);
        delete this.incomingFiles[chunk.id];
      }
    }
  }

  sendText(content: string) {
    if (!this.connection || !this.connection.open) return;

    const messageId = crypto.randomUUID();
    const payload = {
      id: messageId,
      type: 'text',
      content,
      timestamp: Date.now(),
    };

    this.connection.send(payload);

    useStore.getState().addMessage({
      id: messageId,
      senderId: useStore.getState().localPeerId || 'local',
      type: 'text',
      content,
      timestamp: payload.timestamp,
      isSelf: true,
    });
  }

  /**
   * 切片发送文件
   */
  async sendFile(file: File) {
    if (!this.connection || !this.connection.open) return;

    const fileId = crypto.randomUUID();
    const chunkSize = 64 * 1024; // 64KB
    const totalChunks = Math.ceil(file.size / chunkSize);

    const meta: FileMeta = {
      id: fileId,
      type: 'file-meta',
      fileName: file.name,
      fileSize: file.size,
      totalChunks,
      mimeType: file.type,
      timestamp: Date.now(),
    };

    // 发送元数据
    this.connection.send(meta);

    useStore.getState().addMessage({
      id: fileId,
      senderId: useStore.getState().localPeerId || 'local',
      type: 'file',
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
      timestamp: meta.timestamp,
      progress: 0,
      isSelf: true,
    });

    // 读取并发送切片
    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(file.size, start + chunkSize);
      const chunkBlob = file.slice(start, end);
      const chunkBuffer = await chunkBlob.arrayBuffer();

      // 防止底层 DataChannel 缓存被打满溢出
      const rtcDataChannel = this.connection.dataChannel;
      if (rtcDataChannel) {
        // 当缓冲超过 1MB 时稍作等待
        while (rtcDataChannel.bufferedAmount > 1024 * 1024) {
          await new Promise(r => setTimeout(r, 10));
        }
      }

      this.connection.send({
        id: fileId,
        type: 'file-chunk',
        index: i,
        data: chunkBuffer
      } as FileChunk);

      const progress = Math.floor(((i + 1) / totalChunks) * 100);
      useStore.getState().updateMessageProgress(fileId, progress);
    }

    // 发送完成后，本地也可以生成一份预览链接
    const finalUrl = URL.createObjectURL(file);
    useStore.getState().updateMessageFileUrl(fileId, finalUrl);
  }

  disconnect() {
    if (this.connection) {
      this.connection.close();
      this.connection = null;
    }
  }

  destroy() {
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
  }
}

export default new PeerService();
