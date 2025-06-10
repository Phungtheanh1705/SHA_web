// Cấu hình địa chỉ API Backend
const API_BASE_URL = 'http://127.0.0.1:5000/api';
const SOCKET_IO_URL = 'http://127.0.0.1:5000'; // Địa chỉ của Socket.IO server

let MY_IDENTITY = ''; // Sẽ được thiết lập khi initFrontend được gọi
let socket = null;
let currentMessagesListId = ''; // ID của div hiển thị tin nhắn
let currentMessageInputId = ''; // ID của input gửi tin nhắn
let currentFileInputId = '';    // ID của input chọn file
let currentDownloadFileInputId = ''; // ID của select chọn file download
let currentDownloadStatusId = ''; // ID của div hiển thị trạng thái download
let currentSendMessageStatusId = ''; // ID của div hiển thị trạng thái gửi tin nhắn

function initFrontend(identity) {
    MY_IDENTITY = identity;
    currentMessagesListId = `messagesList${MY_IDENTITY}`;
    currentMessageInputId = `messageInput${MY_IDENTITY}`;
    currentFileInputId = `fileInput${MY_IDENTITY}`;
    currentDownloadFileInputId = `downloadFileInput${MY_IDENTITY}`;
    currentDownloadStatusId = `downloadStatus${MY_IDENTITY}`;
    currentSendMessageStatusId = `sendMessageStatus${MY_IDENTITY}`; // Thêm ID này

    // Khởi tạo Socket.IO client
    socket = io(SOCKET_IO_URL);

    socket.on('connect', () => {
        console.log(`[${MY_IDENTITY}] Đã kết nối với Socket.IO server!`);
        socket.emit('set_identity', { identity: MY_IDENTITY });
        displayStatus(`[${MY_IDENTITY}] Đã kết nối với server.`, 'success', currentSendMessageStatusId);
    });

    socket.on('disconnect', () => {
        console.log(`[${MY_IDENTITY}] Đã ngắt kết nối với Socket.IO server.`);
        displayStatus(`[${MY_IDENTITY}] Đã ngắt kết nối với server.`, 'error', currentSendMessageStatusId);
    });

    socket.on('request_identity', () => {
        socket.emit('set_identity', { identity: MY_IDENTITY });
    });

    // Lắng nghe tin nhắn mới được đẩy từ server
    socket.on('new_message', (data) => {
        console.log(`[${MY_IDENTITY}] Nhận tin nhắn mới từ Socket:`, data);
        // data.sender là người gửi, data.message là nội dung
        appendMessageToDisplay(data.sender, data.message, 'received');
        // Thông báo cho người dùng bằng văn bản
        displayStatus(`[${MY_IDENTITY}] Đã nhận tin nhắn từ ${data.sender}.`, 'info', currentSendMessageStatusId);
    });

    // Lắng nghe xác nhận gửi tin nhắn từ server
    socket.on('message_sent_confirm', (data) => {
        console.log(`[${MY_IDENTITY}] Xác nhận gửi tin nhắn:`, data);
        if (data.status === 'success') {
            displayStatus(`[${MY_IDENTITY}] Đã gửi tin nhắn thành công.`, 'success', currentSendMessageStatusId);
            // Tin nhắn gửi đi đã được hiển thị ngay lập tức bởi hàm sendMessage()
        } else {
            displayStatus(`[${MY_IDENTITY}] Gửi tin nhắn thất bại: ${data.message}`, 'error', currentSendMessageStatusId);
        }
    });

    // Lắng nghe khi có file mới được tải lên
    socket.on('new_file_uploaded', (data) => {
        console.log(`[${MY_IDENTITY}] Nhận thông báo file mới:`, data);
        displayStatus(`[${MY_IDENTITY}] Có file mới được tải lên: ${data.original_name}`, 'info', currentDownloadStatusId);
        populateDownloadFiles(); // Cập nhật lại danh sách file để tải xuống
    });

    populateDownloadFiles(); // Lấy danh sách file ban đầu
}


// --- Hàm hỗ trợ chung ---
async function calculateSha256(file) {
    const reader = new FileReader();
    reader.readAsArrayBuffer(file);

    return new Promise((resolve, reject) => {
        reader.onload = async (event) => {
            const buffer = event.target.result;
            const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const hexHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            resolve(hexHash);
        };
        reader.onerror = reject;
    });
}

function displayStatus(message, type = 'info', elementId = null) {
    const statusDiv = document.getElementById(elementId || currentDownloadStatusId);
    if (statusDiv) { // Kiểm tra xem element có tồn tại không
        statusDiv.textContent = message;
        statusDiv.className = `status-message ${type}`;
    }
}

// Hàm mới để thêm tin nhắn vào danh sách
function appendMessageToDisplay(sender, message, type = 'sent') { // 'sent' hoặc 'received'
    const messagesList = document.getElementById(currentMessagesListId);
    if (!messagesList) return; // Đảm bảo element tồn tại

    if (messagesList.querySelector('p.no-message-placeholder')) {
        messagesList.innerHTML = ''; // Xóa placeholder "Chưa có tin nhắn nào."
    }

    const msgItem = document.createElement('div');
    msgItem.className = `message-item message-${type}`; // Thêm class để CSS phân biệt

    const senderSpan = document.createElement('span');
    senderSpan.className = 'message-sender';
    senderSpan.textContent = `[${sender}]: `;

    const messageContentSpan = document.createElement('span');
    messageContentSpan.className = 'message-content';
    messageContentSpan.textContent = message;

    msgItem.appendChild(senderSpan);
    msgItem.appendChild(messageContentSpan);

    messagesList.appendChild(msgItem);
    messagesList.scrollTop = messagesList.scrollHeight; // Cuộn xuống cuối
}

// --- Chức năng Tin Nhắn (gửi qua SocketIO) ---
function sendMessage() {
    const messageInput = document.getElementById(currentMessageInputId); 
    const message = messageInput.value.trim();

    if (!message) {
        displayStatus('Vui lòng nhập tin nhắn!', 'error', currentSendMessageStatusId);
        return;
    }

    // Hiển thị tin nhắn đã gửi đi ngay lập tức trên giao diện của người gửi
    appendMessageToDisplay(MY_IDENTITY, message, 'sent');
    displayStatus('Đang gửi tin nhắn...', 'info', currentSendMessageStatusId);

    // Gửi sự kiện 'send_message_to_other' qua SocketIO
    socket.emit('send_message_to_other', { message: message });
    messageInput.value = ''; // Xóa ô nhập liệu
}


// --- Chức năng File (vẫn dùng REST API, nhưng có thông báo qua SocketIO) ---
async function uploadFile() {
    const fileInput = document.getElementById(currentFileInputId);
    const file = fileInput.files[0];

    if (!file) {
        alert('Vui lòng chọn một file để tải lên.');
        return;
    }

    displayStatus('Đang tính SHA-256 và tải lên...', 'info', currentDownloadStatusId);
    try {
        const sha256_checksum = await calculateSha256(file);

        const formData = new FormData();
        formData.append('file', file);
        formData.append('sha256', sha256_checksum);

        const response = await fetch(`${API_BASE_URL}/upload`, {
            method: 'POST',
            body: formData,
        });

        const result = await response.json();
        if (response.ok) {
            displayStatus(result.message, 'success', currentDownloadStatusId);
            // populateDownloadFiles() sẽ được gọi thông qua sự kiện SocketIO 'new_file_uploaded'
        } else {
            displayStatus(`Lỗi tải lên: ${result.message}`, 'error', currentDownloadStatusId);
        }
    } catch (error) {
        console.error('Lỗi khi tải lên file:', error);
        displayStatus(`Không thể tải lên file: ${error.message}`, 'error', currentDownloadStatusId);
    }
}

async function populateDownloadFiles() {
    try {
        const response = await fetch(`${API_BASE_URL}/list_files`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const files = await response.json();
        const selectElement = document.getElementById(currentDownloadFileInputId);
        if (!selectElement) return; // Đảm bảo element tồn tại

        selectElement.innerHTML = '<option value="">-- Chọn file để tải xuống --</option>';

        if (files.length === 0) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = 'Chưa có file nào trên server.';
            option.disabled = true;
            selectElement.appendChild(option);
        } else {
            files.forEach(filename => {
                const option = document.createElement('option');
                option.value = filename;
                option.textContent = filename;
                selectElement.appendChild(option);
            });
        }
    } catch (error) {
        console.error('Lỗi khi lấy danh sách file:', error);
        displayStatus(`Lỗi khi lấy danh sách file: ${error.message}`, 'error', currentDownloadStatusId);
    }
}

async function downloadFile() {
    const selectElement = document.getElementById(currentDownloadFileInputId);
    const filename = selectElement.value;

    if (!filename) {
        alert('Vui lòng chọn một file để tải xuống.');
        return;
    }

    displayStatus(`Đang tải xuống file: ${filename}...`, 'info', currentDownloadStatusId);
    try {
        const response = await fetch(`${API_BASE_URL}/download/${filename}`);
        if (!response.ok) {
            const errorResult = await response.json();
            throw new Error(errorResult.message || `HTTP error! status: ${response.status}`);
        }

        const receivedSha256 = response.headers.get('X-File-SHA256');
        const blob = await response.blob();
        
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);

        const downloadedFile = new File([blob], filename, { type: blob.type });
        const calculatedSha256 = await calculateSha256(downloadedFile);

        if (calculatedSha256 === receivedSha256) {
            displayStatus(`Tải xuống và kiểm tra tính toàn vẹn thành công cho: ${filename}`, 'success', currentDownloadStatusId);
        } else {
            displayStatus(`Tải xuống thành công nhưng lỗi tính toàn vẹn cho: ${filename}. (Hash không khớp)`, 'error', currentDownloadStatusId);
            console.warn('SHA-256 từ server:', receivedSha256);
            console.warn('SHA-256 tính toán:', calculatedSha256);
        }

    } catch (error) {
        console.error('Lỗi khi tải xuống file:', error);
        displayStatus(`Không thể tải xuống file: ${error.message}`, 'error', currentDownloadStatusId);
    }
}