const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { authenticate, authorize } = require('../middlewares/auth');

router.use(authenticate, authorize('PEMBIMBING'));

/**
 * Endpoint untuk mendapatkan daftar mahasiswa bimbingan.
 */
router.get('/mahasiswa', async (req, res) => {
    try {
        const userId = req.user.id;
        
        const [pembimbingInfo] = await pool.query(
            `SELECT COALESCE(p.nama_lengkap, u.nama_lengkap) AS nama_lengkap, u.identifier
             FROM users u
             LEFT JOIN user_profiles p ON u.id = p.user_id
             WHERE u.id = ? AND u.role = 'PEMBIMBING'`,
            [userId]
        );

        if (!pembimbingInfo.length) {
            return res.status(404).json({ message: 'Pembimbing not found' });
        }
        
        const namaPembimbing = pembimbingInfo[0].nama_lengkap || pembimbingInfo[0].identifier;
        
        const query = `
            SELECT 
                u.id, u.identifier AS nim, COALESCE(p.nama_lengkap, u.nama_lengkap) AS nama_lengkap, p.jurusan, u.email, p.telepon, p.divisi
            FROM user_profiles p
            JOIN users u ON p.user_id = u.id
            WHERE p.pembimbing_lapangan = ?
            ORDER BY u.id DESC
        `;
        const [mahasiswaList] = await pool.query(query, [namaPembimbing]);

        res.json(mahasiswaList);
    } catch (error) {
        console.error('Error fetching students for pembimbing:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

/**
 * Endpoint untuk mendapatkan daftar jurnal dari mahasiswa bimbingan.
 */
router.get('/jurnals', async (req, res) => {
    try {
        const userId = req.user.id;
        const [pembimbingInfo] = await pool.query(
            `SELECT COALESCE(p.nama_lengkap, u.nama_lengkap) AS nama_lengkap, u.identifier
             FROM users u
             LEFT JOIN user_profiles p ON u.id = p.user_id
             WHERE u.id = ? AND u.role = 'PEMBIMBING'`,
            [userId]
        );
        
        if (!pembimbingInfo.length) {
            return res.status(404).json({ message: 'Pembimbing not found' });
        }
        
        const namaPembimbing = pembimbingInfo[0].nama_lengkap || pembimbingInfo[0].identifier;

        const [jurnalList] = await pool.query(
            `SELECT j.*, up.nama_lengkap, u.identifier AS nim
             FROM jurnals j
             JOIN user_profiles up ON j.user_id = up.user_id
             JOIN users u ON j.user_id = u.id
             WHERE up.pembimbing_lapangan = ?
             ORDER BY j.tanggal DESC, j.created_at DESC`,
            [namaPembimbing]
        );
        res.json(jurnalList);
    } catch (error) {
        console.error('Error fetching journals for pembimbing:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

/**
 * Endpoint untuk mendapatkan absensi mahasiswa bimbingan.
 */
router.get('/absensi', async (req, res) => {
    try {
        const userId = req.user.id;
        const [pembimbingInfo] = await pool.query(
            `SELECT COALESCE(p.nama_lengkap, u.nama_lengkap) AS nama_lengkap, u.identifier
             FROM users u
             LEFT JOIN user_profiles p ON u.id = p.user_id
             WHERE u.id = ? AND u.role = 'PEMBIMBING'`,
            [userId]
        );
        
        if (!pembimbingInfo.length) {
            return res.status(404).json({ message: 'Pembimbing not found' });
        }
        
        const namaPembimbing = pembimbingInfo[0].nama_lengkap || pembimbingInfo[0].identifier;
        
        const query = `
            SELECT 
                a.id, a.tanggal, a.waktu_masuk, a.status, a.keterangan,
                u.identifier AS nim_mahasiswa,
                up.nama_lengkap AS nama_mahasiswa
            FROM absensi a
            JOIN users u ON a.user_id = u.id
            JOIN user_profiles up ON u.id = up.user_id
            WHERE up.pembimbing_lapangan = ?
            ORDER BY a.tanggal DESC
        `;
        const [absensi] = await pool.query(query, [namaPembimbing]);

        res.json(absensi);
    } catch (error) {
        console.error('Error fetching absensi for pembimbing:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

module.exports = router;