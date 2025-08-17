const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { authenticate, authorize } = require('../middlewares/auth');

const router = express.Router();

// semua route sini butuh admin
router.use(authenticate, authorize('ADMIN'));

// list users
router.get('/users', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, identifier, email, role, created_at FROM users ORDER BY id DESC');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// create user (admin bisa buat admin/mahasiswa)
router.post('/users', async (req, res) => {
  try {
    const { identifier, email = null, password, role = 'MAHASISWA' } = req.body || {};
    if (!identifier || !password) return res.status(400).json({ message: 'identifier & password wajib' });
    if (!['MAHASISWA','ADMIN'].includes(role)) return res.status(400).json({ message: 'role invalid' });

    const [ex] = await pool.query('SELECT id FROM users WHERE identifier = ? OR (email IS NOT NULL AND email = ?)', [identifier, email]);
    if (ex.length) return res.status(409).json({ message: 'identifier atau email sudah terpakai' });

    const pwdHash = await bcrypt.hash(password, 10);
    await pool.query('INSERT INTO users (identifier, email, password_hash, role) VALUES (?, ?, ?, ?)', [identifier, email, pwdHash, role]);

    res.status(201).json({ message: 'User dibuat' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
