// DOM Elements
const youtubeUrlInput = document.getElementById('youtubeUrl');
const loadVideoBtn = document.getElementById('loadVideo');
const youtubePlayer = document.getElementById('youtube-player');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const toggleCameraBtn = document.getElementById('toggleCamera');
const toggleMicBtn = document.getElementById('toggleMic');
const toggleVideoChatBtn = document.getElementById('toggleVideoChat');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const chatMessages = document.getElementById('chatMessages');
const messageInput = document.getElementById('messageInput');
const sendMessageBtn = document.getElementById('sendMessage');
const clearChatBtn = document.getElementById('clearChat');
const videoChatContainer = document.getElementById('videoChatContainer');

// App State
let youtubePlayerInstance;
let peer;
let localStream;
let currentPeerId;
let partnerPeerId;
let isCameraOn = false;
let isMicOn = false;
let isVideoChatVisible = false;
let roomId = generateRoomId();

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
    // Sync initial state if available
    syncVideoState();
}

function onPlayerStateChange(event) {
    // Only sync if the change wasn't triggered by a remote update
    if (event.data === YT.PlayerState.PLAYING || event.data === YT.PlayerState.PAUSED) {
        const currentTime = youtubePlayerInstance.getCurrentTime();
        database.ref(`rooms/${roomId}/playerState`).set({
            state: event.data,
            currentTime: currentTime,
            timestamp: firebase.database.ServerValue.TIMESTAMP
        });
    }
}

// Initialize WebRTC with PeerJS
async function initPeerJS() {
    // Create a random peer ID
    currentPeerId = 'peer-' + Math.random().toString(36).substr(2, 9);
    peer = new Peer(currentPeerId);
    
    peer.on('open', (id) => {
        console.log('PeerJS connected with ID:', id);
        setupFirebasePresence();
    });
    
    peer.on('call', (call) => {
        call.answer(localStream);
        call.on('stream', (remoteStream) => {
            remoteVideo.srcObject = remoteStream;
            partnerPeerId = call.peer;
            updateConnectionStatus(true);
        });
    });
    
    peer.on('error', (err) => {
        console.error('PeerJS error:', err);
        updateConnectionStatus(false);
    });
}

// Initialize media devices
async function initMediaDevices() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
        isCameraOn = true;
        isMicOn = true;
        updateMediaButtons();
    } catch (err) {
        console.error('Error accessing media devices:', err);
    }
}

// Toggle camera
toggleCameraBtn.addEventListener('click', () => {
    if (localStream) {
        const videoTracks = localStream.getVideoTracks();
        videoTracks.forEach(track => {
            track.enabled = !track.enabled;
        });
        isCameraOn = !isCameraOn;
        updateMediaButtons();
    }
});

// Toggle microphone
toggleMicBtn.addEventListener('click', () => {
    if (localStream) {
        const audioTracks = localStream.getAudioTracks();
        audioTracks.forEach(track => {
            track.enabled = !track.enabled;
        });
        isMicOn = !isMicOn;
        updateMediaButtons();
    }
});

// Toggle video chat visibility
toggleVideoChatBtn.addEventListener('click', () => {
    isVideoChatVisible = !isVideoChatVisible;
    videoChatContainer.classList.toggle('visible', isVideoChatVisible);
});

function updateMediaButtons() {
    toggleCameraBtn.style.backgroundColor = isCameraOn ? 'var(--primary-color)' : 'var(--danger-color)';
    toggleMicBtn.style.backgroundColor = isMicOn ? 'var(--primary-color)' : 'var(--danger-color)';
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
        database.ref(`rooms/${roomId}/currentVideo`).set(videoId);
    } else {
        alert('Please enter a valid YouTube URL');
    }
});

function extractVideoId(url) {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
}

// Firebase presence detection
function setupFirebasePresence() {
    const myConnectionsRef = database.ref(`rooms/${roomId}/connections/${currentPeerId}`);
    const lastOnlineRef = database.ref(`rooms/${roomId}/lastOnline/${currentPeerId}`);
    
    // Store connection in Firebase
    database.ref('.info/connected').on('value', (snapshot) => {
        if (snapshot.val()) {
            // Add this device to connections list
            const con = myConnectionsRef.push(true);
            
            // Remove connection when this tab closes
            con.onDisconnect().remove();
            
            // When I disconnect, update the last time I was seen online
            lastOnlineRef.onDisconnect().set(firebase.database.ServerValue.TIMESTAMP);
        }
    });
    
    // Listen for other connections
    database.ref(`rooms/${roomId}/connections`).on('value', (snapshot) => {
        const connections = snapshot.val() || {};
        const connectionCount = Object.keys(connections).length;
        
        if (connectionCount === 2) {
            updateConnectionStatus(true);
            // If we have a partner, initiate call
            if (!partnerPeerId) {
                findPartnerAndCall();
            }
        } else if (connectionCount === 1) {
            updateConnectionStatus(false, 'Waiting for partner...');
        } else {
            updateConnectionStatus(false, 'Disconnected');
        }
    });
}

function findPartnerAndCall() {
    database.ref(`rooms/${roomId}/connections`).once('value').then((snapshot) => {
        const connections = snapshot.val();
        const peerIds = Object.keys(connections);
        
        // Find the peer ID that isn't ours
        partnerPeerId = peerIds.find(id => id !== currentPeerId);
        
        if (partnerPeerId && localStream) {
            const call = peer.call(partnerPeerId, localStream);
            call.on('stream', (remoteStream) => {
                remoteVideo.srcObject = remoteStream;
                updateConnectionStatus(true);
            });
        }
    });
}

// Sync YouTube video state
function syncVideoState() {
    database.ref(`rooms/${roomId}/playerState`).on('value', (snapshot) => {
        const playerState = snapshot.val();
        if (!playerState || !youtubePlayerInstance) return;
        
        const currentPlayerState = youtubePlayerInstance.getPlayerState();
        const currentTime = youtubePlayerInstance.getCurrentTime();
        
        // Only update if the remote state is newer and different from our current state
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
    database.ref(`rooms/${roomId}/currentVideo`).on('value', (snapshot) => {
        const videoId = snapshot.val();
        if (videoId && youtubePlayerInstance && youtubePlayerInstance.getVideoData().video_id !== videoId) {
            youtubePlayerInstance.loadVideoById(videoId);
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
    if (message) {
        const messageElement = document.createElement('div');
        messageElement.classList.add('message');
        messageElement.textContent = `You: ${message}`;
        chatMessages.appendChild(messageElement);
        messageInput.value = '';
        chatMessages.scrollTop = chatMessages.scrollHeight;
        
        // In a real app, you would send this to your partner via WebRTC data channel or Firebase
    }
}

// Helper functions
function generateRoomId() {
    // For simplicity, we're using a random room ID
    // In a real app, you might want to:
    // 1. Generate a shareable link
    // 2. Let users create/join rooms
    return 'room-' + Math.random().toString(36).substr(2, 6);
}

function updateConnectionStatus(connected, message) {
    statusDot.className = 'status-dot ' + (connected ? 'connected' : message ? 'waiting' : 'disconnected');
    statusText.textContent = connected ? 'Connected' : message || 'Disconnected';
}

// Initialize the app
function initApp() {
    initYouTubePlayer();
    initPeerJS();
    initMediaDevices();
    
    // Display room ID for sharing (in a real app, you'd have a proper sharing mechanism)
    console.log('Room ID:', roomId);
    // For demo purposes, we'll show it in the status
    statusText.textContent = `Room: ${roomId}`;
    
    // Start listening for video state changes
    syncVideoState();
}

// Start the app when DOM is loaded
document.addEventListener('DOMContentLoaded', initApp);