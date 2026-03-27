from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy
import requests, os, json, uuid, hashlib
from datetime import datetime

# PDF Support
try:
    import fitz
    PDF_SUPPORT = 'pymupdf'
except ImportError:
    PDF_SUPPORT = None

app = Flask(__name__)
CORS(app)

UPLOAD_FOLDER = 'uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///novamind.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'


# ══ MODELS ══════════════════════════════════

class User(db.Model):
    id         = db.Column(db.Integer, primary_key=True)
    username   = db.Column(db.String(80), unique=True, nullable=False)
    email      = db.Column(db.String(120), unique=True, nullable=False)
    password   = db.Column(db.String(200), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    chats      = db.relationship('Chat', backref='user', lazy=True)
    summaries  = db.relationship('Summary', backref='user', lazy=True)
    def to_dict(self):
        return {'id': self.id, 'username': self.username, 'email': self.email, 'created_at': self.created_at.isoformat()}

class Chat(db.Model):
    id         = db.Column(db.Integer, primary_key=True)
    session_id = db.Column(db.String(100), unique=True, nullable=False)
    title      = db.Column(db.String(200), default='New Chat')
    messages   = db.Column(db.Text, nullable=False, default='[]')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow)
    user_id    = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    def to_dict(self):
        msgs = json.loads(self.messages)
        return {'session_id': self.session_id, 'title': self.title, 'messages': msgs, 'updated_at': self.updated_at.isoformat(), 'message_count': len(msgs)}

class Summary(db.Model):
    id         = db.Column(db.Integer, primary_key=True)
    input_text = db.Column(db.Text, nullable=False)
    output     = db.Column(db.Text, nullable=False)
    style      = db.Column(db.String(50), default='bullet')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    user_id    = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)

with app.app_context():
    db.create_all()
    print('  Database ready: novamind.db')


# ══ HELPERS ═════════════════════════════════

def hash_pw(p):
    return hashlib.sha256(p.encode()).hexdigest()

def call_gemini(key, prompt, system='You are NovaMind, a helpful AI assistant.'):
    body = {'system_instruction': {'parts': [{'text': system}]}, 'contents': [{'parts': [{'text': prompt}]}], 'generationConfig': {'maxOutputTokens': 2048, 'temperature': 0.7}}
    r = requests.post(f'{GEMINI_URL}?key={key}', json=body, timeout=30)
    r.raise_for_status()
    return r.json()['candidates'][0]['content']['parts'][0]['text']

def call_gemini_chat(key, history, system='You are NovaMind, a helpful AI assistant.'):
    contents = [{'role': 'model' if m['role'] == 'assistant' else 'user', 'parts': [{'text': m['content']}]} for m in history]
    body = {'system_instruction': {'parts': [{'text': system}]}, 'contents': contents, 'generationConfig': {'maxOutputTokens': 2048, 'temperature': 0.7}}
    r = requests.post(f'{GEMINI_URL}?key={key}', json=body, timeout=30)
    r.raise_for_status()
    return r.json()['candidates'][0]['content']['parts'][0]['text']

def api_error(e):
    if hasattr(e, 'response') and e.response is not None:
        if e.response.status_code == 429: return jsonify({'error': 'Rate limit reached. Please wait a moment.'}), 429
        if e.response.status_code == 400: return jsonify({'error': 'Invalid API key.'}), 400
    return jsonify({'error': str(e)}), 500


# ══ STATIC ══════════════════════════════════

@app.route('/')
def index(): return send_from_directory('.', 'index.html')

@app.route('/<path:filename>')
def static_files(filename): return send_from_directory('.', filename)


# ══ AUTH: REGISTER ══════════════════════════

@app.route('/api/register', methods=['POST'])
def register():
    d = request.json
    username = d.get('username', '').strip()
    email    = d.get('email', '').strip().lower()
    password = d.get('password', '')
    if not username or not email or not password: return jsonify({'error': 'All fields are required'}), 400
    if len(username) < 3: return jsonify({'error': 'Username must be at least 3 characters'}), 400
    if len(password) < 6: return jsonify({'error': 'Password must be at least 6 characters'}), 400
    if '@' not in email: return jsonify({'error': 'Invalid email address'}), 400
    if User.query.filter_by(email=email).first(): return jsonify({'error': 'Email already registered'}), 400
    if User.query.filter_by(username=username).first(): return jsonify({'error': 'Username already taken'}), 400
    u = User(username=username, email=email, password=hash_pw(password))
    db.session.add(u); db.session.commit()
    return jsonify({'success': True, 'message': f'Welcome, {username}!', 'user': u.to_dict()})


# ══ AUTH: LOGIN ═════════════════════════════

@app.route('/api/login', methods=['POST'])
def login():
    d = request.json
    email    = d.get('email', '').strip().lower()
    password = d.get('password', '')
    if not email or not password: return jsonify({'error': 'Email and password required'}), 400
    u = User.query.filter_by(email=email, password=hash_pw(password)).first()
    if not u: return jsonify({'error': 'Invalid email or password'}), 401
    chats = Chat.query.filter_by(user_id=u.id).order_by(Chat.updated_at.desc()).limit(30).all()
    return jsonify({'success': True, 'message': f'Welcome back, {u.username}!', 'user': u.to_dict(),
        'chats': [{'session_id': c.session_id, 'title': c.title, 'updated_at': c.updated_at.isoformat(), 'message_count': len(json.loads(c.messages))} for c in chats]})


# ══ CHAT ════════════════════════════════════

@app.route('/api/chat', methods=['POST'])
def chat():
    d = request.json
    api_key, history, session_id, user_id = d.get('api_key',''), d.get('history',[]), d.get('session_id',''), d.get('user_id')
    if not api_key: return jsonify({'error': 'API key required'}), 400
    if not history: return jsonify({'error': 'No message'}), 400
    try:
        reply = call_gemini_chat(api_key, history)
        full  = history + [{'role': 'assistant', 'content': reply}]
        if session_id:
            title = next((m['content'][:60] for m in full if m['role'] == 'user'), 'New Chat')
            ex    = Chat.query.filter_by(session_id=session_id).first()
            if ex: ex.messages = json.dumps(full); ex.title = title; ex.updated_at = datetime.utcnow()
            else: db.session.add(Chat(session_id=session_id, title=title, messages=json.dumps(full), user_id=user_id))
            db.session.commit()
        return jsonify({'response': reply})
    except requests.exceptions.HTTPError as e: return api_error(e)
    except Exception as e: return jsonify({'error': str(e)}), 500


# ══ SUMMARIZE ═══════════════════════════════

@app.route('/api/summarize', methods=['POST'])
def summarize():
    d = request.json
    api_key, text, style, user_id = d.get('api_key',''), d.get('text',''), d.get('style','bullet'), d.get('user_id')
    if not api_key: return jsonify({'error': 'API key required'}), 400
    if not text.strip(): return jsonify({'error': 'No text provided'}), 400
    prompts = {'bullet': 'Summarize as bullet points using -.', 'paragraph': 'Write a paragraph summary.', 'tldr': 'One sentence TL;DR.', 'detailed': 'Detailed analysis of all major points.', 'executive': 'Executive summary with key takeaways.'}
    try:
        result = call_gemini(api_key, f"{prompts.get(style, prompts['bullet'])}\n\n---\n{text[:8000]}", 'You are an expert document analyst.')
        db.session.add(Summary(input_text=text[:500], output=result, style=style, user_id=user_id))
        db.session.commit()
        return jsonify({'summary': result})
    except requests.exceptions.HTTPError as e: return api_error(e)
    except Exception as e: return jsonify({'error': str(e)}), 500


# ══ MATH ════════════════════════════════════

@app.route('/api/math', methods=['POST'])
def solve_math():
    d = request.json
    api_key, q = d.get('api_key',''), d.get('question','')
    if not api_key: return jsonify({'error': 'API key required'}), 400
    try:
        ans = call_gemini(api_key, f'Solve step by step: {q}', 'You are a math expert.')
        return jsonify({'answer': ans})
    except requests.exceptions.HTTPError as e: return api_error(e)
    except Exception as e: return jsonify({'error': str(e)}), 500


# ══ FILE UPLOAD ═════════════════════════════

@app.route('/api/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files: return jsonify({'error': 'No file'}), 400
    file = request.files['file']
    if not file.filename: return jsonify({'error': 'No filename'}), 400
    fp = os.path.join(UPLOAD_FOLDER, f'{uuid.uuid4().hex}_{file.filename}')
    file.save(fp)
    try:
        content = extract_pdf(fp) if file.filename.lower().endswith('.pdf') else open(fp, encoding='utf-8', errors='ignore').read()
        return jsonify({'filename': file.filename, 'content': content[:10000], 'size': os.path.getsize(fp), 'chars': len(content)})
    except Exception as e: return jsonify({'error': str(e)}), 500
    finally:
        try: os.remove(fp)
        except: pass

def extract_pdf(fp):
    if PDF_SUPPORT == 'pymupdf':
        doc = fitz.open(fp); text = '\n'.join(p.get_text() for p in doc); doc.close()
        return text.strip() or 'No text found in PDF.'
    return 'PDF not supported. Run: pip install pymupdf'


# ══ CHAT HISTORY ════════════════════════════

@app.route('/api/history/<sid>', methods=['GET'])
def get_history(sid):
    c = Chat.query.filter_by(session_id=sid).first()
    return jsonify(c.to_dict()) if c else (jsonify({'error': 'Not found'}), 404)

@app.route('/api/history/<sid>', methods=['DELETE'])
def delete_history(sid):
    c = Chat.query.filter_by(session_id=sid).first()
    if c: db.session.delete(c); db.session.commit()
    return jsonify({'success': True})


# ══ HEALTH ══════════════════════════════════

@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok', 'version': '3.0.0', 'pdf_support': PDF_SUPPORT, 'database': 'connected',
        'stats': {'users': User.query.count(), 'chats': Chat.query.count(), 'summaries': Summary.query.count()}})


if __name__ == '__main__':
    print('=' * 45)
    print('  NovaMind AI v3.0 -> http://localhost:5000')
    print('=' * 45)
    print(f'  PDF     : {PDF_SUPPORT or "Not installed"}')
    print(f'  Database: novamind.db (auto-created)')
    print('=' * 45)
    app.run(debug=True, port=5000)