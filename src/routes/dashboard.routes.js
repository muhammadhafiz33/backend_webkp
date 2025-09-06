const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middlewares/auth');

const router = express.Router();

// Semua rute di sini memerlukan autentikasi
router.use(authenticate);

// GET /api/dashboard/student -> Mendapatkan data rangkuman untuk dashboard mahasiswa
router.get('/student', async (req, res) => {
    try {
        const userId = req.user.id;

        const [jurnalStats] = await pool.query(
            `SELECT
                COUNT(*) as totalJurnals,
                SUM(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END) as jurnalsApproved,
                SUM(jam_kerja) as totalJamKerja
            FROM jurnals
            WHERE user_id = ?`,
            [userId]
        );

        const [latestJurnals] = await pool.query(
            'SELECT id, tanggal, kegiatan, status FROM jurnals WHERE user_id = ? ORDER BY tanggal DESC LIMIT 3',
            [userId]
        );
        
        const stats = {
            totalJurnals: jurnalStats[0].totalJurnals || 0,
            jurnalsApproved: jurnalStats[0].jurnalsApproved || 0,
            totalJamKerja: parseFloat(jurnalStats[0].totalJamKerja) || 0,
            tingkatKehadiran: '96%' // Ini masih data statis untuk sekarang
        };

        res.json({ stats, latestJurnals });

    } catch (err) {
        console.error('Error fetching student dashboard data:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// GET /api/dashboard/admin -> Mendapatkan data rangkuman untuk dashboard admin
router.get('/admin', async (req, res) => {
    try {
        const today = new Date().toISOString().slice(0, 10);

        // 1. Total Mahasiswa
        const [mahasiswaCount] = await pool.query("SELECT COUNT(*) as total FROM users WHERE role = 'MAHASISWA'");

        // 2. Jurnal Pending
        const [pendingCount] = await pool.query("SELECT COUNT(*) as total FROM jurnals WHERE status = 'PENDING'");
        
        // 3. Kehadiran Hari Ini
        const [hadirCount] = await pool.query("SELECT COUNT(*) as total FROM absensi WHERE tanggal = ?", [today]);

        // 4. Jurnal terbaru yang pending
        const [pendingJurnals] = await pool.query(
            `SELECT j.id, j.tanggal, j.kegiatan, u.identifier as nim 
             FROM jurnals j JOIN users u ON j.user_id = u.id 
             WHERE j.status = 'PENDING' 
             ORDER BY j.tanggal DESC, j.created_at DESC LIMIT 5`
        );

        const stats = {
            totalMahasiswa: mahasiswaCount[0].total || 0,
            jurnalPending: pendingCount[0].total || 0,
            kehadiranHariIni: hadirCount[0].total || 0,
        };

        res.json({ stats, pendingJurnals });

    } catch (err) {
        console.error('Error fetching admin dashboard data:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// GET /api/dashboard/pembimbing -> Mendapatkan data rangkuman untuk dashboard pembimbing
router.get('/pembimbing', async (req, res) => {
    try {
        const userId = req.user.id;

        // Ambil nama lengkap pembimbing yang sedang login
        const [pembimbingUser] = await pool.query(
            'SELECT nama_lengkap FROM users WHERE id = ?',
            [userId]
        );

        if (pembimbingUser.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }
        const namaPembimbing = pembimbingUser[0].nama_lengkap;

        // 1. Total Mahasiswa Bimbingan
        const [mahasiswaCount] = await pool.query(
            "SELECT COUNT(*) as total FROM user_profiles WHERE pembimbing_lapangan = ?",
            [namaPembimbing]
        );

        // 2. Jurnal Pending
        const [pendingCount] = await pool.query(
            `SELECT COUNT(*) as total FROM jurnals j
             JOIN user_profiles p ON j.user_id = p.user_id
             WHERE p.pembimbing_lapangan = ? AND j.status = 'PENDING'`,
            [namaPembimbing]
        );

        // 3. Jurnal Disetujui
        const [approvedCount] = await pool.query(
            `SELECT COUNT(*) as total FROM jurnals j
             JOIN user_profiles p ON j.user_id = p.user_id
             WHERE p.pembimbing_lapangan = ? AND j.status = 'APPROVED'`,
            [namaPembimbing]
        );
        
        // 4. Jurnal terbaru yang pending dari mahasiswa bimbingan
        const [pendingJurnals] = await pool.query(
            `SELECT 
                j.id, j.tanggal, j.kegiatan, u.identifier as nim, p.nama_lengkap 
             FROM jurnals j 
             JOIN user_profiles p ON j.user_id = p.user_id
             JOIN users u ON j.user_id = u.id
             WHERE p.pembimbing_lapangan = ? AND j.status = 'PENDING' 
             ORDER BY j.tanggal DESC, j.created_at DESC LIMIT 5`,
            [namaPembimbing]
        );

        const stats = {
            totalMahasiswaBimbingan: mahasiswaCount[0].total || 0,
            jurnalPending: pendingCount[0].total || 0,
            jurnalsApproved: approvedCount[0].total || 0,
        };

        res.json({ stats, pendingJurnals });

    } catch (err) {
        console.error('Error fetching pembimbing dashboard data:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;