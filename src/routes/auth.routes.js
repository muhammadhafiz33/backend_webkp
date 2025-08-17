const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');

const router = express.Router();

// REGISTER Mahasiswa
// body: { nim, email, password }
router.post('/register', async (req, res) => {
  try {
    const { nim, email, password } = req.body || {};
    if (!nim || !email || !password) return res.status(400).json({ message: 'Lengkapi semua field' });

    // Cek unik
    const [ex] = await pool.query('SELECT id FROM users WHERE identifier = ? OR email = ?', [nim, email]);
    if (ex.length) return res.status(409).json({ message: 'NIM atau Email sudah terdaftar' });

    const password_hash = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users (identifier, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [nim, email, password_hash, 'MAHASISWA']
    );

    res.status(201).json({ message: 'Register berhasil' });
  } catch (err) {
    console.error('Register error', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// LOGIN (Mahasiswa atau Admin)
// body: { identifier, password, role }  role wajib 'MAHASISWA' or 'ADMIN'
router.post('/login', async (req, res) => {
  try {
    const { identifier, password, role } = req.body || {};
    if (!identifier || !password || !role) return res.status(400).json({ message: 'identifier, password, role wajib' });
    if (!['MAHASISWA','ADMIN'].includes(role)) return res.status(400).json({ message: 'role invalid' });

    const [rows] = await pool.query('SELECT * FROM users WHERE identifier = ? AND role = ?', [identifier, role]);
    const user = rows[0];
    if (!user) return res.status(401).json({ message: 'Akun tidak ditemukan' });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ message: 'Password salah' });

    const payload = { id: user.id, identifier: user.identifier, role: user.role };
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '4h' });

    res.json({
      token,
      user: { id: user.id, identifier: user.identifier, email: user.email, role: user.role }
    });
  } catch (err) {
    console.error('Login error', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Who am I
const { authenticate } = require('../middlewares/auth');
router.get('/me', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, identifier, email, role, created_at FROM users WHERE id = ?', [req.user.id]);
    const me = rows[0];
    if (!me) return res.status(404).json({ message: 'User not found' });
    res.json(me);
  } catch (err) {
    console.error('Me error', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
