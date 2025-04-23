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
const createRoomBtn = document.getElementById('createRoom');
const joinRoomBtn = document.getElementById('joinRoom');
const roomIdInput = document.getElementById('roomIdInput');
const displayRoomId = document.getElementById('displayRoomId');
const copyRoomLinkBtn = document.getElementById('copyRoomLink');

// App State
let youtubePlayerInstance;
let peer;
let localStream;
let currentPeerId;
let partnerPeerId;
let isCameraOn = false;
let isMicOn = false;
let isVideoChatVisible = false;
let roomId = null;
let isRoomOwner = false;
let dataChannel;

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
    if (roomId) {
        syncVideoState();
    }
}

function onPlayerStateChange(event) {
    if (!roomId) return;
    
    // Only sync if the change wasn't triggered by a remote update
    if (event.data === YT.PlayerState.PLAYING || event.data === YT.PlayerState.PAUSED) {
        const currentTime = youtubePlayerInstance.getCurrentTime();
        database.ref(`rooms/${roomId}/playerState`).set({
            state: event.data,
            currentTime: currentTime,
            timestamp: firebase.database.ServerValue.TIMESTAMP,
            sender: currentPeerId
        });
    }
}

// Initialize WebRTC with PeerJS
async function initPeerJS() {
    try {
        // Create a random peer ID
        currentPeerId = 'peer-' + Math.random().toString(36).substr(2, 9);
        peer = new Peer(currentPeerId);
        
        peer.on('open', (id) => {
            console.log('PeerJS connected with ID:', id);
            if (roomId) {
                setupFirebasePresence();
            }
        });
        
        peer.on('call', (call) => {
            call.answer(localStream);
            call.on('stream', (remoteStream) => {
                remoteVideo.srcObject = remoteStream;
                partnerPeerId = call.peer;
                updateConnectionStatus(true);
            });
            
            // Set up data channel for chat
            call.on('dataChannel', (channel) => {
                setupDataChannel(channel);
            });
        });
        
        peer.on('error', (err) => {
            console.error('PeerJS error:', err);
            updateConnectionStatus(false);
        });
    } catch (err) {
        console.error('PeerJS initialization error:', err);
    }
}

// Initialize media devices
async function initMediaDevices() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ 
            video: true, 
            audio: true 
        });
        localVideo.srcObject = localStream;
        isCameraOn = true;
        isMicOn = true;
        updateMediaButtons();
    } catch (err) {
        console.error('Error accessing media devices:', err);
        alert('Could not access camera/microphone. Please check permissions.');
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
    if (!roomId) {
        alert('Please create or join a room first');
        return;
    }
    
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
        database.ref(`rooms/${roomId}/currentVideo`).set({
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
            
            // Create data channel for chat
            dataChannel = call.peerConnection.createDataChannel('chat');
            setupDataChannel(dataChannel);
        }
    });
}

function setupDataChannel(channel) {
    dataChannel = channel;
    
    dataChannel.onopen = () => {
        console.log('Data channel opened');
    };
    
    dataChannel.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.type === 'chat') {
            addMessageToChat(message.content, false);
        }
    };
    
    dataChannel.onclose = () => {
        console.log('Data channel closed');
    };
}

// Sync YouTube video state
function syncVideoState() {
    database.ref(`rooms/${roomId}/playerState`).on('value', (snapshot) => {
        const playerState = snapshot.val();
        if (!playerState || !youtubePlayerInstance || playerState.sender === currentPeerId) return;
        
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
    if (message) {
        addMessageToChat(message, true);
        
        if (dataChannel && dataChannel.readyState === 'open') {
            dataChannel.send(JSON.stringify({
                type: 'chat',
                content: message
            }));
        }
        
        messageInput.value = '';
    }
}

function addMessageToChat(message, isLocal) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('message');
    messageElement.textContent = `${isLocal ? 'You' : 'Partner'}: ${message}`;
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Room Management
createRoomBtn.addEventListener('click', createNewRoom);
joinRoomBtn.addEventListener('click', joinExistingRoom);
copyRoomLinkBtn.addEventListener('click', copyRoomLink);

function createNewRoom() {
    roomId = generateRoomId();
    isRoomOwner = true;
    updateRoomUI();
    initializeRoomConnection();
}

function joinExistingRoom() {
    const inputRoomId = roomIdInput.value.trim();
    if (!inputRoomId) {
        alert('Please enter a room ID');
        return;
    }
    
    // Validate room ID format
    if (!/^[a-z]+-[a-z]+-\d{3}$/.test(inputRoomId)) {
        alert('Please enter a valid room ID in the format: word-word-123');
        return;
    }
    
    roomId = inputRoomId;
    isRoomOwner = false;
    updateRoomUI();
    initializeRoomConnection();
}

function initializeRoomConnection() {
    // Show video controls
    document.querySelector('.video-container').style.display = 'block';
    document.querySelector('.collaboration-panel').style.display = 'block';
    
    // Initialize media devices and sync
    initMediaDevices();
    syncVideoState();
    
    // Set up presence detection
    if (peer && peer.id) {
        setupFirebasePresence();
    }
}

function updateRoomUI() {
    displayRoomId.textContent = roomId;
    roomIdInput.value = roomId;
    statusText.textContent = isRoomOwner ? 'Room owner - ' + roomId : 'Joined - ' + roomId;
}

function copyRoomLink() {
    if (!roomId) return;
    
    const roomLink = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
    navigator.clipboard.writeText(roomLink).then(() => {
        alert('Room link copied to clipboard!');
    }).catch(err => {
        console.error('Failed to copy room link:', err);
        // Fallback for browsers that don't support clipboard API
        roomIdInput.select();
        document.execCommand('copy');
        alert('Room ID copied to clipboard!');
    });
}

function generateRoomId() {
    const adjectives = ['happy', 'sunny', 'quick', 'bright', 'gentle', 'jolly', 'clever', 'brave'];
    const nouns = ['study', 'learn', 'brain', 'book', 'desk', 'focus', 'mind', 'wisdom'];
    const randomAdj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const randomNoun = nouns[Math.floor(Math.random() * nouns.length)];
    const randomNum = Math.floor(100 + Math.random() * 900); // 3-digit number
    
    return `${randomAdj}-${randomNoun}-${randomNum}`;
}

function checkUrlForRoomId() {
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    
    if (roomParam) {
        roomIdInput.value = roomParam;
        joinExistingRoom();
    }
}

function updateConnectionStatus(connected, message) {
    statusDot.className = 'status-dot ' + (connected ? 'connected' : message ? 'waiting' : 'disconnected');
    statusText.textContent = connected ? 'Connected' : message || 'Disconnected';
}

// Clean up on page unload
window.addEventListener('beforeunload', () => {
    if (peer) {
        peer.destroy();
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
});

// Initialize the app
function initApp() {
    initYouTubePlayer();
    initPeerJS();
    checkUrlForRoomId();
}

document.addEventListener('DOMContentLoaded', initApp);
