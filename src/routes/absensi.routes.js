const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middlewares/auth');

const router = express.Router();
router.use(authenticate);

// Fungsi untuk mendapatkan tanggal hari ini dalam format YYYY-MM-DD
const getTodayDate = () => new Date().toISOString().slice(0, 10);

// GET /api/absensi/status -> Cek status absensi hari ini
router.get('/status', async (req, res) => {
    try {
        const userId = req.user.id;
        const today = getTodayDate();
        const [rows] = await pool.query(
            'SELECT * FROM absensi WHERE user_id = ? AND tanggal = ?',
            [userId, today]
        );
        
        if (rows.length > 0) {
            res.json({ status: 'checked_in', data: rows[0] });
        } else {
            res.json({ status: 'not_checked_in' });
        }
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
});

// POST /api/absensi/check-in -> Melakukan check-in
router.post('/check-in', async (req, res) => {
    try {
        const userId = req.user.id;
        const today = getTodayDate();
        const now = new Date();
        const currentTime = now.toTimeString().slice(0, 8);
        const currentHour = now.getHours();

        // Cek apakah sudah check-in sebelumnya
        const [existing] = await pool.query('SELECT id FROM absensi WHERE user_id = ? AND tanggal = ?', [userId, today]);
        if (existing.length > 0) {
            return res.status(409).json({ message: 'Anda sudah melakukan check-in hari ini.' });
        }
        
        // Tentukan status berdasarkan jam
        const status = currentHour > 8 ? 'TERLAMBAT' : 'HADIR';

        await pool.query(
            'INSERT INTO absensi (user_id, tanggal, waktu_masuk, status) VALUES (?, ?, ?, ?)',
            [userId, today, currentTime, status]
        );
        
        res.status(201).json({ message: 'Check-in berhasil.' });
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
});

// PATCH /api/absensi/check-out -> Melakukan check-out
router.patch('/check-out', async (req, res) => {
    try {
        const userId = req.user.id;
        const today = getTodayDate();
        const currentTime = new Date().toTimeString().slice(0, 8);

        const [entry] = await pool.query('SELECT id, waktu_keluar FROM absensi WHERE user_id = ? AND tanggal = ?', [userId, today]);
        if (entry.length === 0) {
            return res.status(404).json({ message: 'Anda belum check-in hari ini.' });
        }
        if (entry[0].waktu_keluar) {
            return res.status(409).json({ message: 'Anda sudah melakukan check-out hari ini.' });
        }

        await pool.query(
            'UPDATE absensi SET waktu_keluar = ? WHERE id = ?',
            [currentTime, entry[0].id]
        );

        res.json({ message: 'Check-out berhasil.' });
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
});

// GET /api/absensi/history -> Mendapatkan riwayat absensi
router.get('/history', async (req, res) => {
    try {
        const userId = req.user.id;
        const [rows] = await pool.query(
            'SELECT * FROM absensi WHERE user_id = ? ORDER BY tanggal DESC LIMIT 5',
            [userId]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
});

router.post('/izin', authenticate, async (req, res) => {
    try {
        // Otomatis mengambil user_id dari token
        const userId = req.user.id;
        const { alasan, tanggal_izin } = req.body;

        if (!alasan || !tanggal_izin) {
            return res.status(400).json({ message: 'Alasan dan tanggal izin wajib diisi' });
        }

        // Cek apakah sudah ada izin atau absensi untuk tanggal yang sama
        const [existing] = await pool.query(
            `SELECT id FROM absensi WHERE user_id = ? AND tanggal = ?`,
            [userId, tanggal_izin]
        );

        if (existing.length > 0) {
            return res.status(409).json({ message: 'Anda sudah absen atau mengajukan izin untuk tanggal ini.' });
        }

        // Masukkan data izin langsung ke tabel
        await pool.query(
            `INSERT INTO izin (user_id, alasan, tanggal_izin) VALUES (?, ?, ?)`,
            [userId, alasan, tanggal_izin]
        );

        res.status(201).json({ message: 'Permintaan izin berhasil diajukan.' });
    } catch (err) {
        console.error('Izin error:', err);
        res.status(500).json({ message: 'Terjadi kesalahan server.' });
    }
});

// GET /api/absensi/izin/history -> Mendapatkan riwayat izin user
router.get('/izin/history', async (req, res) => {
    try {
        const userId = req.user.id;
        console.log('User ID:', userId); // Debug: cek user id
        const [rows] = await pool.query(
            'SELECT * FROM izin WHERE user_id = ? ORDER BY tanggal_izin DESC LIMIT 5',
            [userId]
        );
        console.log('Izin rows:', rows); // Debug: cek hasil query
        res.json(rows);
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
});

// GET /api/absensi/izin/history/all -> Admin: Mendapatkan semua riwayat izin beserta nama mahasiswa dan email
router.get('/izin/history/all', async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT izin.*, users.identifier AS nim, users.email
             FROM izin 
             JOIN users ON izin.user_id = users.id 
             ORDER BY izin.tanggal_izin DESC`
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
