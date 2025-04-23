// DOM Elements
const youtubeUrlInput = document.getElementById('youtubeUrl');
const loadVideoBtn = document.getElementById('loadVideo');
const youtubePlayer = document.getElementById('youtube-player');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const chatMessages = document.getElementById('chatMessages');
const messageInput = document.getElementById('messageInput');
const sendMessageBtn = document.getElementById('sendMessage');
const clearChatBtn = document.getElementById('clearChat');

// App State
let youtubePlayerInstance;
let peer;
let currentPeerId;
let partnerPeerId;
let dataChannel;
let isConnected = false;

// Initialize YouTube Player
function initYouTubePlayer() {
    const tag = document.createElement('script');
    tag.src = "https://www.youtube.com/iframe_api";
    const firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
}

window.onYouTubeIframeAPIReady = function() {
    youtubePlayerInstance = new YT.Player('youtube-player', {
        height: '100%',
        width: '100%',
        events: {
            'onReady': onPlayerReady,
            'onStateChange': onPlayerStateChange
        }
    });
};

function onPlayerReady(event) {
    console.log('YouTube player ready');
    syncVideoState();
}

function onPlayerStateChange(event) {
    // Only sync if the change wasn't triggered by a remote update
    if (event.data === YT.PlayerState.PLAYING || event.data === YT.PlayerState.PAUSED) {
        const currentTime = youtubePlayerInstance.getCurrentTime();
        database.ref('playerState').set({
            state: event.data,
            currentTime: currentTime,
            timestamp: firebase.database.ServerValue.TIMESTAMP,
            sender: currentPeerId
        });
    }
}

// Initialize PeerJS
function initPeerJS() {
    try {
        currentPeerId = 'peer-' + Math.random().toString(36).substr(2, 9);
        peer = new Peer(currentPeerId);
        
        peer.on('open', (id) => {
            console.log('PeerJS connected with ID:', id);
            updateConnectionStatus(false, 'Waiting for partner...');
            setupConnectionListener();
        });
        
        peer.on('error', (err) => {
            console.error('PeerJS error:', err);
            updateConnectionStatus(false, 'Connection error');
        });
    } catch (err) {
        console.error('PeerJS initialization error:', err);
    }
}

function setupConnectionListener() {
    // Listen for incoming data connections
    peer.on('connection', (conn) => {
        conn.on('open', () => {
            partnerPeerId = conn.peer;
            dataChannel = conn;
            setupDataChannel();
            updateConnectionStatus(true);
            
            // If we're the second to connect, we'll initiate the call
            if (!isConnected) {
                isConnected = true;
            }
        });
    });
    
    // Try to connect to existing peer (if any)
    database.ref('activePeer').once('value').then((snapshot) => {
        const activePeerId = snapshot.val();
        
        if (activePeerId && activePeerId !== currentPeerId) {
            // Connect to existing peer
            partnerPeerId = activePeerId;
            const conn = peer.connect(partnerPeerId);
            
            conn.on('open', () => {
                dataChannel = conn;
                setupDataChannel();
                updateConnectionStatus(true);
                isConnected = true;
            });
            
            conn.on('error', (err) => {
                console.error('Connection error:', err);
                updateConnectionStatus(false, 'Failed to connect');
            });
        } else {
            // We're the first peer, register ourselves
            database.ref('activePeer').set(currentPeerId);
            database.ref('activePeer').onDisconnect().remove();
        }
    });
}

function setupDataChannel() {
    dataChannel.on('data', (data) => {
        const message = JSON.parse(data);
        if (message.type === 'chat') {
            addMessageToChat(message.content, false);
        }
    });
    
    dataChannel.on('close', () => {
        updateConnectionStatus(false, 'Partner disconnected');
    });
    
    dataChannel.on('error', (err) => {
        console.error('Data channel error:', err);
        updateConnectionStatus(false, 'Chat error');
    });
}

// Load YouTube video
loadVideoBtn.addEventListener('click', () => {
    const url = youtubeUrlInput.value.trim();
    if (!url) return;
    
    const videoId = extractVideoId(url);
    if (videoId) {
        if (youtubePlayerInstance) {
            youtubePlayerInstance.loadVideoById(videoId);
        } else {
            youtubePlayerInstance = new YT.Player('youtube-player', {
                height: '100%',
                width: '100%',
                videoId: videoId,
                events: {
                    'onReady': onPlayerReady,
                    'onStateChange': onPlayerStateChange
                }
            });
        }
        
        // Save the current video to Firebase
        database.ref('currentVideo').set({
            videoId: videoId,
            sender: currentPeerId
        });
    } else {
        alert('Please enter a valid YouTube URL');
    }
});

function extractVideoId(url) {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
}

// Sync YouTube video state
function syncVideoState() {
    database.ref('playerState').on('value', (snapshot) => {
        const playerState = snapshot.val();
        if (!playerState || !youtubePlayerInstance || playerState.sender === currentPeerId) return;
        
        const currentPlayerState = youtubePlayerInstance.getPlayerState();
        const currentTime = youtubePlayerInstance.getCurrentTime();
        
        // Only update if the remote state is different from our current state
        if (playerState.state !== currentPlayerState || 
            Math.abs(playerState.currentTime - currentTime) > 1) {
            
            if (playerState.state === YT.PlayerState.PLAYING) {
                youtubePlayerInstance.seekTo(playerState.currentTime, true);
                youtubePlayerInstance.playVideo();
            } else if (playerState.state === YT.PlayerState.PAUSED) {
                youtubePlayerInstance.seekTo(playerState.currentTime, true);
                youtubePlayerInstance.pauseVideo();
            }
        }
    });
    
    // Sync current video
    database.ref('currentVideo').on('value', (snapshot) => {
        const videoData = snapshot.val();
        if (!videoData || !youtubePlayerInstance || videoData.sender === currentPeerId) return;
        
        if (videoData.videoId && youtubePlayerInstance.getVideoData().video_id !== videoData.videoId) {
            youtubePlayerInstance.loadVideoById(videoData.videoId);
        }
    });
}

// Chat functionality
sendMessageBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

clearChatBtn.addEventListener('click', () => {
    chatMessages.innerHTML = '';
});

function sendMessage() {
    const message = messageInput.value.trim();
    if (message && dataChannel && dataChannel.open) {
        addMessageToChat(message, true);
        dataChannel.send(JSON.stringify({
            type: 'chat',
            content: message
        }));
        messageInput.value = '';
    } else if (!dataChannel || !dataChannel.open) {
        alert('No partner connected to chat with');
    }
}

function addMessageToChat(message, isLocal) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('message');
    messageElement.textContent = `${isLocal ? 'You' : 'Partner'}: ${message}`;
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function updateConnectionStatus(connected, message) {
    statusDot.className = 'status-dot ' + (connected ? 'connected' : 'disconnected');
    statusText.textContent = connected ? 'Connected' : message || 'Disconnected';
}

// Clean up on page unload
window.addEventListener('beforeunload', () => {
    if (peer) {
        peer.destroy();
    }
    if (dataChannel) {
        dataChannel.close();
    }
});

// Initialize the app
function initApp() {
    initYouTubePlayer();
    initPeerJS();
}

document.addEventListener('DOMContentLoaded', initApp);