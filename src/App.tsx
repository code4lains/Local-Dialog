import React, { useEffect, useState, useRef } from 'react';
import {
  ThemeProvider, createTheme, CssBaseline, Box, Typography,
  TextField, IconButton, Paper, LinearProgress, Button, Dialog,
  DialogTitle, DialogContent, DialogActions, Chip, List, ListItem, ListItemButton, ListItemText, ListItemAvatar, Avatar, Snackbar
} from '@mui/material';
import Send from '@mui/icons-material/Send';
import AttachFile from '@mui/icons-material/AttachFile';
import FileDownload from '@mui/icons-material/FileDownload';
import SignalCellularAlt from '@mui/icons-material/SignalCellularAlt';
import DevicesIcon from '@mui/icons-material/Devices';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutlined';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import ComputerIcon from '@mui/icons-material/Computer';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useStore } from './store/useStore';
import peerService from './services/PeerService';
import discoveryService from './services/DiscoveryService';
import { QRCodeSVG } from 'qrcode.react';

// Create a more expansive, premium dark theme
const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#7c4dff' },
    secondary: { main: '#00e5ff' },
    background: {
      default: '#07070a', // very deep background
      paper: '#12121a',   // slightly elevated paper
    },
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
  },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          backdropFilter: 'blur(10px)',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          textTransform: 'none',
          fontWeight: 600,
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
        }
      }
    }
  },
});

function formatBytes(bytes: number = 0) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export default function App() {
  const {
    localPeerId, connectionStatus, messages, pendingConnection, remotePeerId, discoveredPeers
  } = useStore();

  const [textInput, setTextInput] = useState('');
  const [showRoomDialog, setShowRoomDialog] = useState(false);
  const [currentRoomUrl, setCurrentRoomUrl] = useState('');
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const endOfMessagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const init = async () => {
      const hasRoom = await discoveryService.checkUrlAndConnect();
      if (!hasRoom) {
        await discoveryService.autoDiscover();
      }
    };
    init();
  }, []);

  useEffect(() => {
    endOfMessagesRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendText = () => {
    if (textInput.trim() && connectionStatus === 'connected') {
      peerService.sendText(textInput);
      setTextInput('');
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && connectionStatus === 'connected') {
      peerService.sendFile(file);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleCreateRoom = async () => {
    const roomId = discoveryService.generateRoomId();
    await peerService.initialize(roomId);
    const link = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
    setCurrentRoomUrl(link);
    setShowRoomDialog(true);
  };

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(currentRoomUrl);
    setSnackbarOpen(true);
  };

  return (
    <ThemeProvider theme={darkTheme}>
      <CssBaseline />
      
      {/* Background with subtle ambient gradients */}
      <Box sx={{ 
        height: '100dvh', 
        display: 'flex', 
        p: { xs: 0, md: 3 }, 
        bgcolor: 'background.default',
        backgroundImage: 'radial-gradient(circle at 15% 50%, rgba(124, 77, 255, 0.08), transparent 25%), radial-gradient(circle at 85% 30%, rgba(0, 229, 255, 0.08), transparent 25%)',
        overflow: 'hidden'
      }}>
        
        <Box sx={{ 
          flex: 1, 
          display: 'flex', 
          flexDirection: { xs: 'column', md: 'row' }, 
          maxWidth: '1600px', 
          margin: '0 auto', 
          gap: { xs: 0, md: 3 }, 
          width: '100%' 
        }}>
          
          {/* Left Sidebar (Control Panel & Device Discovery) */}
          <Paper 
            elevation={4} 
            sx={{ 
              width: { xs: '100%', md: '360px' }, 
              display: { xs: connectionStatus === 'connected' ? 'none' : 'flex', md: 'flex' }, 
              flexDirection: 'column', 
              borderRadius: { xs: 0, md: 4 }, 
              flexShrink: 0, 
              border: '1px solid rgba(255,255,255,0.05)',
              overflow: 'hidden'
            }}
          >
            {/* Header branding */}
            <Box sx={{ p: 3, pb: 2, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <Typography variant="h5" sx={{
                fontWeight: 800,
                background: 'linear-gradient(45deg, #7c4dff, #00e5ff)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                mb: 1
              }}>
                Local Dialog
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                安全的点对点大文件传输助手
              </Typography>

              {/* My Status Card */}
              <Box sx={{ bgcolor: 'rgba(255,255,255,0.03)', p: 2, borderRadius: 3, border: '1px solid rgba(255,255,255,0.05)' }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 'bold' }}>本机标识 ID</Typography>
                  <Chip 
                    icon={<SignalCellularAlt fontSize="small" />} 
                    label={connectionStatus === 'connected' ? '已连接' : connectionStatus === 'connecting' ? '连接中' : '等待连接'}
                    size="small"
                    color={connectionStatus === 'connected' ? 'success' : connectionStatus === 'connecting' ? 'warning' : 'default'}
                    variant={connectionStatus === 'connected' ? 'filled' : 'outlined'}
                  />
                </Box>
                <Typography variant="body2" sx={{ wordBreak: 'break-all', fontFamily: 'monospace', color: 'primary.light' }}>
                  {localPeerId || '正在分配中...'}
                </Typography>
              </Box>

              {/* Action Buttons */}
              {connectionStatus !== 'connected' && (
                <Button 
                  variant="contained" 
                  fullWidth 
                  startIcon={<QrCode2Icon />}
                  onClick={handleCreateRoom}
                  sx={{ mt: 2, py: 1.5, background: 'linear-gradient(45deg, #7c4dff, #5c3ce6)' }}
                >
                  创建专属传输房间
                </Button>
              )}
            </Box>

            {/* Discovered Peers List */}
            <Box sx={{ p: 2, flex: 1, overflowY: 'auto' }}>
              <Typography variant="overline" color="text.secondary" sx={{ px: 1, fontWeight: 'bold' }}>
                <DevicesIcon sx={{ fontSize: 14, mr: 1, verticalAlign: 'text-top' }} />
                发现的设备 ({discoveredPeers.length})
              </Typography>
              <List sx={{ mt: 1 }}>
                {discoveredPeers.length === 0 ? (
                  <Typography variant="body2" color="text.disabled" sx={{ p: 2, textAlign: 'center' }}>
                    局域网内暂无其他设备...
                  </Typography>
                ) : (
                  discoveredPeers.map(peer => (
                    <ListItem disablePadding key={peer.id} sx={{ mb: 1 }}>
                      <ListItemButton 
                        selected={remotePeerId === peer.id}
                        onClick={() => { if(connectionStatus !== 'connected') peerService.connect(peer.id); }}
                        sx={{ bgcolor: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.03)' }}
                      >
                        <ListItemAvatar>
                          <Avatar sx={{ bgcolor: remotePeerId === peer.id ? 'primary.main' : 'background.paper' }}>
                            <ComputerIcon />
                          </Avatar>
                        </ListItemAvatar>
                        <ListItemText 
                          primary={peer.id === localPeerId ? "本机主机" : "未知设备"} 
                          secondary={peer.id.substring(0, 15) + '...'} 
                          primaryTypographyProps={{ variant: 'body2', sx: { fontWeight: 'bold' } }}
                          secondaryTypographyProps={{ variant: 'caption' }}
                        />
                      </ListItemButton>
                    </ListItem>
                  ))
                )}
              </List>
            </Box>
          </Paper>

          {/* Right Main Area (Chat & Transfer) */}
          <Paper 
            elevation={6} 
            sx={{ 
              flex: 1, 
              display: { xs: connectionStatus === 'connected' ? 'flex' : 'none', md: 'flex' }, 
              flexDirection: 'column', 
              borderRadius: { xs: 0, md: 4 }, 
              border: '1px solid rgba(255,255,255,0.05)',
              bgcolor: 'rgba(18, 18, 26, 0.8)',
              overflow: 'hidden'
            }}
          >
            {connectionStatus !== 'connected' ? (
              <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', p: 4, textAlign: 'center' }}>
                <ChatBubbleOutlineIcon sx={{ fontSize: 80, color: 'rgba(255,255,255,0.05)', mb: 3 }} />
                <Typography variant="h5" color="text.primary" sx={{ fontWeight: '300', mb: 2 }}>
                  准备好发送文件了吗？
                </Typography>
                <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 400 }}>
                  请在左侧列表中选择一个设备进行连接，或者点击“创建专属传输房间”让对方扫码加入。
                </Typography>
              </Box>
            ) : (
              <>
                {/* Chat Header */}
                <Box sx={{ p: 2, borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', gap: 2, bgcolor: 'rgba(255,255,255,0.01)' }}>
                  <Avatar sx={{ bgcolor: 'secondary.dark' }}><ComputerIcon /></Avatar>
                  <Box>
                    <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>已连接的设备</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>{remotePeerId}</Typography>
                  </Box>
                  <Button 
                    color="error" 
                    size="small" 
                    sx={{ ml: 'auto' }}
                    onClick={() => peerService.disconnect()}
                  >
                    断开连接
                  </Button>
                </Box>

                {/* Messages Area */}
                <Box sx={{ flex: 1, overflowY: 'auto', p: { xs: 2, md: 4 }, display: 'flex', flexDirection: 'column' }}>
                  {messages.length === 0 ? (
                    <Box sx={{ m: 'auto', textAlign: 'center', color: 'text.disabled' }}>
                      <Typography variant="body1">连接已建立，端到端加密通道已准备就绪。</Typography>
                      <Typography variant="body2">现在可以发送文字或拖拽文件到这里了。</Typography>
                    </Box>
                  ) : (
                    messages.map((msg) => {
                      const isSelf = msg.isSelf;
                      return (
                        <Box key={msg.id} sx={{ display: 'flex', justifyContent: isSelf ? 'flex-end' : 'flex-start', mb: 3 }}>
                          <Box sx={{
                            maxWidth: { xs: '85%', md: '60%' },
                            p: 2.5,
                            borderRadius: isSelf ? '20px 20px 4px 20px' : '20px 20px 20px 4px',
                            bgcolor: isSelf ? 'primary.main' : 'rgba(255,255,255,0.05)',
                            boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
                            border: isSelf ? 'none' : '1px solid rgba(255,255,255,0.05)'
                          }}>
                            {msg.type === 'text' ? (
                              <Typography variant="body1" sx={{ wordBreak: 'break-word', lineHeight: 1.6 }}>
                                {msg.content}
                              </Typography>
                            ) : (
                              <Box>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
                                  <Box sx={{ p: 1, bgcolor: 'rgba(0,0,0,0.2)', borderRadius: 2, display: 'flex' }}>
                                    <AttachFile fontSize="small" />
                                  </Box>
                                  <Box sx={{ overflow: 'hidden' }}>
                                    <Typography variant="body2" noWrap sx={{ fontWeight: 'bold' }}>
                                      {msg.fileName}
                                    </Typography>
                                    <Typography variant="caption" sx={{ color: isSelf ? 'rgba(255,255,255,0.7)' : 'text.secondary' }}>
                                      {formatBytes(msg.fileSize)}
                                    </Typography>
                                  </Box>
                                </Box>
                                
                                {msg.progress !== undefined && msg.progress < 100 && (
                                  <Box sx={{ width: '100%', mt: 2 }}>
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                                      <Typography variant="caption">传输中...</Typography>
                                      <Typography variant="caption">{msg.progress}%</Typography>
                                    </Box>
                                    <LinearProgress 
                                      variant="determinate" 
                                      value={msg.progress} 
                                      color={isSelf ? "inherit" : "secondary"} 
                                      sx={{ height: 6, borderRadius: 3, bgcolor: 'rgba(0,0,0,0.2)' }}
                                    />
                                  </Box>
                                )}
                                
                                {msg.progress === 100 && msg.fileUrl && (
                                  <Button 
                                    variant="contained" 
                                    size="small" 
                                    startIcon={<FileDownload />}
                                    href={msg.fileUrl}
                                    download={msg.fileName}
                                    sx={{ 
                                      mt: 1.5, 
                                      width: '100%', 
                                      bgcolor: isSelf ? 'rgba(0,0,0,0.2)' : 'secondary.dark',
                                      color: 'white',
                                      '&:hover': { bgcolor: isSelf ? 'rgba(0,0,0,0.3)' : 'secondary.main' }
                                    }}
                                    disableElevation
                                  >
                                    {isSelf ? '打开本地文件' : '下载接收文件'}
                                  </Button>
                                )}
                              </Box>
                            )}
                          </Box>
                        </Box>
                      );
                    })
                  )}
                  <div ref={endOfMessagesRef} />
                </Box>

                {/* Input Area */}
                <Box sx={{ p: { xs: 2, md: 3 }, borderTop: '1px solid rgba(255,255,255,0.05)', bgcolor: 'rgba(255,255,255,0.01)' }}>
                  <Box sx={{ display: 'flex', gap: 1.5 }}>
                    <input 
                      type="file" 
                      ref={fileInputRef} 
                      style={{ display: 'none' }} 
                      onChange={handleFileSelect} 
                    />
                    <IconButton 
                      color="primary" 
                      onClick={() => fileInputRef.current?.click()}
                      sx={{ 
                        bgcolor: 'rgba(255,255,255,0.05)', 
                        borderRadius: 3,
                        width: 56,
                        height: 56,
                        '&:hover': { bgcolor: 'rgba(255,255,255,0.1)' }
                      }}
                    >
                      <AttachFile />
                    </IconButton>
                    <TextField 
                      fullWidth 
                      variant="outlined" 
                      placeholder="输入消息，回车发送..."
                      value={textInput}
                      onChange={(e) => setTextInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSendText()}
                      sx={{
                        '& .MuiOutlinedInput-root': {
                          bgcolor: 'rgba(255,255,255,0.02)',
                          borderRadius: 3,
                          height: 56,
                          '& fieldset': { borderColor: 'rgba(255,255,255,0.1)' },
                          '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.2)' },
                          '&.Mui-focused fieldset': { borderColor: 'primary.main' },
                        }
                      }}
                    />
                    <IconButton 
                      color="primary" 
                      onClick={handleSendText}
                      disabled={!textInput.trim()}
                      sx={{ 
                        bgcolor: 'primary.main', 
                        color: 'white', 
                        borderRadius: 3,
                        width: 56,
                        height: 56,
                        '&:hover': { bgcolor: 'primary.dark' },
                        '&.Mui-disabled': { bgcolor: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.2)' }
                      }}
                    >
                      <Send />
                    </IconButton>
                  </Box>
                </Box>
              </>
            )}
          </Paper>

        </Box>

        {/* Connection Request Dialog */}
        <Dialog 
          open={!!pendingConnection}
          sx={{ '& .MuiDialog-paper': { bgcolor: 'background.paper', borderRadius: 4, p: 1 } }}
        >
          <DialogTitle sx={{ fontWeight: 'bold' }}>收到连接请求</DialogTitle>
          <DialogContent>
            <Typography>设备 <Typography component="span" color="secondary" sx={{ fontWeight: 'bold' }}>{pendingConnection?.peer}</Typography> 正在请求与您建立点对点连接，是否允许？</Typography>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={() => pendingConnection && peerService.rejectConnection(pendingConnection)} color="inherit" sx={{ px: 3 }}>
              拒绝
            </Button>
            <Button onClick={() => pendingConnection && peerService.acceptConnection(pendingConnection)} variant="contained" color="primary" sx={{ px: 4 }}>
              允许
            </Button>
          </DialogActions>
        </Dialog>

        {/* Create Room / QR Code Dialog */}
        <Dialog 
          open={showRoomDialog} 
          onClose={() => setShowRoomDialog(false)}
          sx={{ '& .MuiDialog-paper': { bgcolor: 'background.paper', borderRadius: 4, p: 1 } }}
        >
          <DialogTitle sx={{ fontWeight: 'bold', textAlign: 'center' }}>专属传输房间</DialogTitle>
          <DialogContent sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', px: 4, py: 2 }}>
            <Box sx={{ p: 2, bgcolor: 'white', borderRadius: 3, mb: 3, boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
              <QRCodeSVG value={currentRoomUrl} size={220} />
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', bgcolor: 'rgba(255,255,255,0.05)', p: 1.5, borderRadius: 2 }}>
              <Typography variant="body2" color="text.secondary" align="center" sx={{ wordBreak: 'break-all', mr: 1 }}>
                {currentRoomUrl}
              </Typography>
              <IconButton size="small" color="primary" onClick={handleCopyUrl} sx={{ bgcolor: 'rgba(255,255,255,0.05)' }}>
                <ContentCopyIcon fontSize="small" />
              </IconButton>
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 3, textAlign: 'center' }}>
              请让需要发送文件的设备扫描上方二维码，<br/>或者直接复制链接在浏览器中打开。
            </Typography>
          </DialogContent>
          <DialogActions sx={{ justifyContent: 'center', pb: 3 }}>
            <Button onClick={() => setShowRoomDialog(false)} variant="outlined" sx={{ px: 5, borderRadius: 8 }}>完成</Button>
          </DialogActions>
        </Dialog>

      </Box>

      <Snackbar
        open={snackbarOpen}
        autoHideDuration={2000}
        onClose={() => setSnackbarOpen(false)}
        message="房间链接已复制到剪贴板"
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </ThemeProvider>
  );
}
