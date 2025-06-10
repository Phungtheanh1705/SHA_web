import os
# Đã xóa import sys, io vì không còn cần chuyển hướng stdout/stderr
from flask import Flask, request, jsonify, send_from_directory
from flask_socketio import SocketIO, emit
from flask_cors import CORS
import hashlib

# Đã xóa sys.stdout = io.TextIOWrapper(...) và sys.stderr = io.TextIOWrapper(...)
# Vì vấn đề Unicode đã được giải quyết ở cấp độ terminal và nó có thể gây xung đột với các server web

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}}) # Cho phép CORS từ mọi nguồn

# ĐÂY LÀ DÒNG ĐÃ SỬA VÀ ĐÚNG: Bỏ async_mode='gevent' để sử dụng chế độ mặc định (Werkzeug hoặc Eventlet nếu cài đặt)
socketio = SocketIO(app, cors_allowed_origins="*") 

UPLOAD_FOLDER = os.path.join(os.getcwd(), 'received_files')
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

# Dictionary để lưu trữ user_sid (Socket ID) của từng Web A và Web B
# Dùng để gửi tin nhắn/thông báo riêng tới từng client
connected_clients = {} # {'WebA': <sid>, 'WebB': <sid>}

@socketio.on('connect')
def handle_connect():
    print(f'Client connected: {request.sid}')

@socketio.on('disconnect')
def handle_disconnect():
    print(f'Client disconnected: {request.sid}')
    # Xóa client khỏi danh sách khi ngắt kết nối
    for identity, sid in list(connected_clients.items()):
        if sid == request.sid:
            del connected_clients[identity]
            print(f'Removed {identity} from connected clients.')
            break

@socketio.on('set_identity')
def handle_set_identity(data):
    identity = data.get('identity')
    if identity:
        connected_clients[identity] = request.sid
        print(f'Client {request.sid} identified as {identity}. Connected clients: {connected_clients}')
        emit('identity_set_confirm', {'status': 'success', 'identity': identity}, room=request.sid)

@socketio.on('send_message_to_other')
def handle_send_message_to_other(data):
    message = data.get('message')
    sender_sid = request.sid
    sender_identity = None

    # Tìm danh tính của người gửi
    for identity, sid in connected_clients.items():
        if sid == sender_sid:
            sender_identity = identity
            break

    if not sender_identity:
        print(f"Lỗi: Không tìm thấy danh tính của người gửi có SID {sender_sid}")
        emit('message_sent_confirm', {'status': 'error', 'message': 'Sender identity not found'}, room=sender_sid)
        return

    print(f"[{sender_identity}] gửi tin nhắn: {message}") # In ra console server

    # Xác định người nhận
    receiver_identity = 'WebB' if sender_identity == 'WebA' else 'WebA'
    receiver_sid = connected_clients.get(receiver_identity)

    if receiver_sid:
        # Gửi tin nhắn đến người nhận
        emit('new_message', {'sender': sender_identity, 'message': message}, room=receiver_sid)
        # Gửi xác nhận lại cho người gửi
        emit('message_sent_confirm', {'status': 'success', 'message': 'Message sent successfully'}, room=sender_sid)
        print(f"Đã chuyển tin nhắn từ {sender_identity} tới {receiver_identity}")
    else:
        # Nếu người nhận không online
        emit('message_sent_confirm', {'status': 'error', 'message': f'{receiver_identity} không online.'}, room=sender_sid)
        print(f"Lỗi: {receiver_identity} không online để nhận tin nhắn từ {sender_identity}")


# API để tải lên file
@app.route('/api/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({'message': 'Không có phần file trong request'}), 400

    file = request.files['file']
    sha256_checksum = request.form.get('sha256')

    if file.filename == '':
        return jsonify({'message': 'Không có file nào được chọn'}), 400

    if file and sha256_checksum:
        filename = file.filename
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)

        # Lưu file tạm thời để tính toán hash
        file.save(filepath)

        # Tính toán SHA-256 của file đã lưu
        calculated_sha256 = hashlib.sha256(open(filepath, 'rb').read()).hexdigest()

        if calculated_sha256 == sha256_checksum:
            # Nếu hash khớp, giữ file và thông báo thành công
            print(f"File {filename} đã được tải lên thành công với SHA-256: {calculated_sha256}")
            # Thông báo cho tất cả các frontend có file mới được tải lên
            socketio.emit('new_file_uploaded', {'original_name': filename, 'sha256': calculated_sha256})
            return jsonify({'message': 'File tải lên thành công và hash khớp!', 'filename': filename}), 200
        else:
            # Nếu hash không khớp, xóa file tạm thời và thông báo lỗi
            os.remove(filepath)
            print(f"Lỗi: SHA-256 của file {filename} không khớp. Tính toán: {calculated_sha256}, Nhận được: {sha256_checksum}")
            return jsonify({'message': 'Lỗi: SHA-256 của file không khớp.'}), 400
    else:
        return jsonify({'message': 'Thiếu file hoặc SHA-256 checksum.'}), 400

# API để liệt kê các file đã tải lên
@app.route('/api/list_files', methods=['GET'])
def list_files():
    files = os.listdir(app.config['UPLOAD_FOLDER'])
    return jsonify(files), 200

# API để tải xuống file
@app.route('/api/download/<filename>', methods=['GET'])
def download_file(filename):
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    if os.path.exists(filepath):
        # Tính toán SHA-256 trước khi gửi đi
        file_sha256 = hashlib.sha256(open(filepath, 'rb').read()).hexdigest()
        response = send_from_directory(app.config['UPLOAD_FOLDER'], filename, as_attachment=True)
        response.headers["X-File-SHA256"] = file_sha256 # Thêm header SHA-256
        return response
    else:
        return jsonify({'message': 'File không tồn tại.'}), 404

if __name__ == '__main__':
    print("Khởi động Backend Server...")
    try:
        # Đảm bảo dòng này CHÍNH XÁC là như vậy, không có async_mode
        socketio.run(app, debug=True, allow_unsafe_werkzeug=True)
    except Exception as e:
        print(f"Lỗi khi khởi động server: {e}")
        # Dòng này chỉ là hướng dẫn, không phải nguyên nhân lỗi hiện tại
        print("Đảm bảo bạn đã cài đặt Flask-SocketIO và Flask-CORS: pip install Flask Flask-SocketIO Flask-Cors")