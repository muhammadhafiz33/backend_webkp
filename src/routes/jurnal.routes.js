const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middlewares/auth');

const router = express.Router();

// Semua rute di sini memerlukan autentikasi
router.use(authenticate);

// GET /api/jurnals -> Mendapatkan semua jurnal milik mahasiswa yang login
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id; // ID didapat dari token JWT setelah middleware authenticate
    const [jurnals] = await pool.query(
      'SELECT * FROM jurnals WHERE user_id = ? ORDER BY tanggal DESC',
      [userId]
    );
    res.json(jurnals);
  } catch (err) {
    console.error('Error fetching jurnals:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/jurnals -> Membuat jurnal baru
router.post('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const { tanggal, kegiatan, deskripsi, jam_kerja, hambatan, rencana_selanjutnya } = req.body;

    // Validasi input dasar
    if (!tanggal || !kegiatan || !deskripsi || !jam_kerja) {
      return res.status(400).json({ message: 'Field wajib (tanggal, kegiatan, deskripsi, jam_kerja) harus diisi' });
    }

    await pool.query(
      'INSERT INTO jurnals (user_id, tanggal, kegiatan, deskripsi, jam_kerja, hambatan, rencana_selanjutnya, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [userId, tanggal, kegiatan, deskripsi, jam_kerja, hambatan, rencana_selanjutnya, 'PENDING']
    );

    res.status(201).json({ message: 'Jurnal berhasil dibuat' });
  } catch (err) {
    console.error('Error creating jurnal:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
