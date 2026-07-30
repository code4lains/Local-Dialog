import { create } from 'zustand';


function getDeviceName() {
  const ua = navigator.userAgent;
  if (/windows/i.test(ua)) return 'Windows 电脑';
  if (/macintosh/i.test(ua)) return 'Mac 电脑';
  if (/iphone/i.test(ua)) return 'iPhone';
  if (/ipad/i.test(ua)) return 'iPad';
  if (/android/i.test(ua)) return 'Android 手机';
  return '未知设备';
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

export interface Message {
  id: string;
  senderId: string;
  type: 'text' | 'file';
  content?: string;
  
  // File properties
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  progress?: number;
  fileUrl?: string; // 组装完成后的下载链接，或者发送方本地的 Blob URL

  timestamp: number;
  isSelf: boolean;
}

export interface PeerDevice {
  id: string;
  name?: string;
  lastSeen: number;
}

interface AppState {
  localPeerId: string | null;
  localDeviceName: string;
  connectionStatus: ConnectionStatus;
  remotePeerId: string | null; 
  messages: Message[];
  discoveredPeers: PeerDevice[];
  pendingConnection: any | null;

  // Actions
  setLocalPeerId: (id: string) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  setRemotePeerId: (id: string | null) => void;
  addMessage: (message: Message) => void;
  updateMessageProgress: (id: string, progress: number) => void;
  updateMessageFileUrl: (id: string, fileUrl: string) => void;
  addDiscoveredPeer: (peerId: string, name?: string) => void;
  removeDiscoveredPeers: (peerIds: string[]) => void;
  clearMessages: () => void;
  setPendingConnection: (conn: any | null) => void;
}

export const useStore = create<AppState>((set) => ({
  localPeerId: null,
  localDeviceName: getDeviceName(),
  connectionStatus: 'disconnected',
  remotePeerId: null,
  messages: [],
  discoveredPeers: [],
  pendingConnection: null,

  setLocalPeerId: (id) => set({ localPeerId: id }),
  setConnectionStatus: (status) => set({ connectionStatus: status }),
  setRemotePeerId: (id) => set({ remotePeerId: id }),
  
  addMessage: (message) => 
    set((state) => ({ messages: [...state.messages, message] })),
    
  updateMessageProgress: (id, progress) =>
    set((state) => ({
      messages: state.messages.map((msg) =>
        msg.id === id ? { ...msg, progress } : msg
      ),
    })),
    
  updateMessageFileUrl: (id, fileUrl) =>
    set((state) => ({
      messages: state.messages.map((msg) =>
        msg.id === id ? { ...msg, fileUrl } : msg
      ),
    })),
    
  addDiscoveredPeer: (peerId, name) =>
    set((state) => {
      const exists = state.discoveredPeers.find((p) => p.id === peerId);
      if (exists) {
        return {
          discoveredPeers: state.discoveredPeers.map((p) =>
            p.id === peerId ? { ...p, lastSeen: Date.now(), name: name || p.name } : p
          ),
        };
      }
      return {
        discoveredPeers: [
          ...state.discoveredPeers,
          { id: peerId, name, lastSeen: Date.now() },
        ],
      };
    }),

  removeDiscoveredPeers: (peerIds) =>
    set((state) => ({
      discoveredPeers: state.discoveredPeers.filter((p) => !peerIds.includes(p.id)),
    })),
    
  clearMessages: () => set({ messages: [] }),
  setPendingConnection: (conn) => set({ pendingConnection: conn }),
}));
