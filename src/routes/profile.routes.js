const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middlewares/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Konfigurasi multer untuk upload foto
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = path.join(__dirname, '..', '..', 'uploads');
    if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    cb(null, `profile_${req.user.id}_${Date.now()}${ext}`);
  }
});
const upload = multer({ storage });

const router = express.Router();

// Semua rute di sini memerlukan autentikasi
router.use(authenticate);

// GET /api/profile/me -> Mendapatkan profil lengkap pengguna yang login
router.get('/me', async (req, res) => {  
  try {
    const userId = req.user.id;
    const [rows] = await pool.query(
      `SELECT 
        u.identifier as nim, 
        u.email, 
        p.* FROM users u
      LEFT JOIN user_profiles p ON u.id = p.user_id
      WHERE u.id = ?`,
      [userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Profil tidak ditemukan' });
    }
    
    const profile = rows[0];
    
    // Kirim data dengan nama field yang konsisten dengan frontend
    res.json({
        nim: profile.nim,
        email: profile.email,
        nama: profile.nama_lengkap,
        telepon: profile.telepon,
        alamat: profile.alamat,
        universitas: profile.universitas,
        jurusan: profile.jurusan,
        angkatan: profile.angkatan,
        tanggalMulai: profile.tanggal_mulai_kp,
        tanggalSelesai: profile.tanggal_selesai_kp,
        pembimbing: profile.pembimbing_lapangan,
        divisi: profile.divisi,
        foto: profile.foto_profil_url
    });

  } catch (err) {
    console.error('Error fetching profile:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/profile/me -> Memperbarui profil pengguna yang login (dengan metode UPSERT)
router.put('/me', upload.single('foto'), async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      nama, email, telepon, alamat, universitas, jurusan,
      angkatan, tanggalMulai, tanggalSelesai, pembimbing, divisi
    } = req.body;

    // Helper: ubah string kosong jadi null
    const toNull = val => (val === '' ? null : val);

    // Update email di tabel users jika ada
    if (email) {
      await pool.query('UPDATE users SET email = ? WHERE id = ?', [email, userId]);
    }

    // Handle foto profil
    let fotoUrl = null;
    if (req.file) {
      // Simpan path relatif ke database
      fotoUrl = `/uploads/${req.file.filename}`;
    }

    await pool.query(
      `INSERT INTO user_profiles (
          user_id, nama_lengkap, telepon, alamat, universitas, jurusan, angkatan,
          tanggal_mulai_kp, tanggal_selesai_kp, pembimbing_lapangan, divisi, foto_profil_url
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
          nama_lengkap = VALUES(nama_lengkap),
          telepon = VALUES(telepon),
          alamat = VALUES(alamat),
          universitas = VALUES(universitas),
          jurusan = VALUES(jurusan),
          angkatan = VALUES(angkatan),
          tanggal_mulai_kp = VALUES(tanggal_mulai_kp),
          tanggal_selesai_kp = VALUES(tanggal_selesai_kp),
          pembimbing_lapangan = VALUES(pembimbing_lapangan),
          divisi = VALUES(divisi),
          foto_profil_url = IF(VALUES(foto_profil_url) IS NOT NULL, VALUES(foto_profil_url), foto_profil_url)
      `,
      [
        userId,
        toNull(nama),
        toNull(telepon),
        toNull(alamat),
        toNull(universitas),
        toNull(jurusan),
        toNull(angkatan),
        toNull(tanggalMulai),
        toNull(tanggalSelesai),
        toNull(pembimbing),
        toNull(divisi),
        fotoUrl
      ]
    );

    res.json({ message: 'Profil berhasil diperbarui' });
  } catch (err) {
    console.error('Error updating profile:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
