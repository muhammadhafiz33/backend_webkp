const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { authenticate, authorize } = require('../middlewares/auth');
const PDFDocument = require('pdfkit');

const router = express.Router();

// semua route sini butuh admin
router.use(authenticate, authorize('ADMIN'));

// ... (endpoint /users yang sudah ada)
router.get('/users', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        u.id, 
        u.identifier as nim, 
        u.email, 
        u.nama_lengkap, 
        p.telepon, 
        p.jurusan, 
        p.divisi
      FROM users u
      LEFT JOIN user_profiles p ON u.id = p.user_id
      WHERE u.role = 'MAHASISWA'
      ORDER BY u.id DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/admin/users/:nim -> Mendapatkan profil lengkap satu mahasiswa
router.get('/users/:nim', async (req, res) => {
    try {
        const { nim } = req.params;
        const [rows] = await pool.query(
            `SELECT 
                u.identifier as nim, 
                u.email, 
                u.nama_lengkap,a
                p.* FROM users u
            LEFT JOIN user_profiles p ON u.id = p.user_id
            WHERE u.identifier = ? AND u.role = 'MAHASISWA'`,
            [nim]
        );

        if (rows.length === 0) {
            return res.status(404).json({ message: 'Profil mahasiswa tidak ditemukan' });
        }
        
        res.json(rows[0]);

    } catch (err) {
        console.error('Error fetching single profile:', err);
        res.status(500).json({ message: 'Server error' });
    }
});


router.post('/users', async (req, res) => {
  try {
    const { identifier, email = null, password, role = 'MAHASISWA', nama_lengkap = null } = req.body || {};
    if (!identifier || !password) return res.status(400).json({ message: 'identifier & password wajib' });
    if (!['MAHASISWA','ADMIN'].includes(role)) return res.status(400).json({ message: 'role invalid' });

    const [ex] = await pool.query('SELECT id FROM users WHERE identifier = ? OR (email IS NOT NULL AND email = ?)', [identifier, email]);
    if (ex.length) return res.status(409).json({ message: 'identifier atau email sudah terpakai' });

    const pwdHash = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users (identifier, email, password_hash, role, nama_lengkap) VALUES (?, ?, ?, ?, ?)',
      [identifier, email, pwdHash, role, nama_lengkap]
    );

    res.status(201).json({ message: 'User dibuat' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

router.delete('/users/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const [result] = await pool.query("DELETE FROM users WHERE id = ? AND role = 'MAHASISWA'", [id]);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Mahasiswa tidak ditemukan atau Anda tidak berhak menghapus user ini.' });
        }

        res.json({ message: 'Mahasiswa berhasil dihapus' });
    } catch (err) {
        console.error('Error deleting user:', err);
        res.status(500).json({ message: 'Server error' });
    }
});


// ... (endpoint /jurnals yang sudah ada)
router.get('/jurnals', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT j.*, u.identifier as nim
      FROM jurnals j
      JOIN users u ON j.user_id = u.id
      ORDER BY j.tanggal DESC, j.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching all jurnals:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/jurnals/export', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT 
                u.identifier as nim,
                p.nama_lengkap as nama,
                DATE_FORMAT(j.tanggal, '%d-%m-%Y') as tanggal,
                j.kegiatan,
                j.status
            FROM jurnals j
            JOIN users u ON j.user_id = u.id
            LEFT JOIN user_profiles p ON u.id = p.user_id
            ORDER BY j.tanggal DESC
        `);

        if (rows.length === 0) {
            return res.status(404).json({ message: 'Tidak ada data jurnal untuk diekspor.' });
        }

        const doc = new PDFDocument({ margin: 30, size: 'A4' });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename=laporan-jurnal.pdf');
        doc.pipe(res);
        doc.fontSize(16).text('Laporan Jurnal Kegiatan Mahasiswa', { align: 'center' });
        doc.moveDown();
        const tableTop = 100;
        const columnWidths = [80, 120, 70, 200, 60];
        const columnPositions = [30, 110, 230, 300, 500];
        doc.fontSize(10).font('Helvetica-Bold');
        ['NIM', 'Nama', 'Tanggal', 'Kegiatan', 'Status'].forEach((header, i) => {
            doc.text(header, columnPositions[i], tableTop);
        });
        doc.moveTo(30, tableTop + 15).lineTo(565, tableTop + 15).stroke();
        doc.font('Helvetica');
        let y = tableTop + 20;
        rows.forEach(row => {
            doc.text(row.nim || '-', columnPositions[0], y, { width: columnWidths[0], align: 'left' });
            doc.text(row.nama || '-', columnPositions[1], y, { width: columnWidths[1], align: 'left' });
            doc.text(row.tanggal || '-', columnPositions[2], y, { width: columnWidths[2], align: 'left' });
            doc.text(row.kegiatan || '-', columnPositions[3], y, { width: columnWidths[3], align: 'left' });
            doc.text(row.status || '-', columnPositions[4], y, { width: columnWidths[4], align: 'left' });
            const rowHeight = Math.max(doc.heightOfString(row.kegiatan, { width: columnWidths[3] }), 20);
            y += rowHeight + 10;
            if (y > 750) {
                doc.addPage();
                y = tableTop;
            }
        });
        doc.end();
    } catch (err) {
        console.error('Error exporting jurnals to PDF:', err);
        res.status(500).json({ message: 'Server error saat membuat PDF' });
    }
});

router.patch('/jurnals/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, komentar_admin } = req.body;
    if (!['APPROVED', 'REJECTED'].includes(status)) {
      return res.status(400).json({ message: 'Status tidak valid' });
    }
    await pool.query('UPDATE jurnals SET status = ?, komentar_admin = ? WHERE id = ?', [status, komentar_admin || null, id]);
    res.json({ message: 'Status jurnal berhasil diperbarui' });
  } catch (err) {
    console.error('Error updating jurnal status:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ... (endpoint /absensi yang sudah ada)
router.get('/absensi', async (req, res) => {
    try {
        const { tanggal } = req.query;
        if (!tanggal) return res.status(400).json({ message: 'Parameter tanggal wajib diisi' });
        const [rows] = await pool.query(
            `SELECT a.*, u.identifier as nim, p.nama_lengkap 
             FROM absensi a
             JOIN users u ON a.user_id = u.id
             LEFT JOIN user_profiles p ON u.id = p.user_id
             WHERE a.tanggal = ?
             ORDER BY u.identifier ASC`,
            [tanggal]
        );
        res.json(rows);
    } catch (err) {
        console.error('Error fetching all attendance:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

router.get('/absensi/export', async (req, res) => {
    try {
        const { tanggal } = req.query;
        if (!tanggal) return res.status(400).json({ message: 'Parameter tanggal wajib diisi untuk ekspor.' });

        const [rows] = await pool.query(
            `SELECT u.identifier as nim, p.nama_lengkap as nama, DATE_FORMAT(a.tanggal, '%d-%m-%Y') as tanggal,
                    a.waktu_masuk, a.waktu_keluar, a.status
             FROM absensi a
             JOIN users u ON a.user_id = u.id
             LEFT JOIN user_profiles p ON u.id = p.user_id
             WHERE a.tanggal = ?
             ORDER BY u.identifier ASC`,
            [tanggal]
        );

        if (rows.length === 0) return res.status(404).json({ message: 'Tidak ada data absensi untuk diekspor pada tanggal ini.' });

        const doc = new PDFDocument({ margin: 30, size: 'A4' });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=laporan-absensi-${tanggal}.pdf`);
        doc.pipe(res);

        doc.fontSize(16).text(`Laporan Absensi Mahasiswa - ${new Date(tanggal).toLocaleDateString('id-ID', { dateStyle: 'full' })}`, { align: 'center' });
        doc.moveDown();

        const tableTop = 100;
        const columnPositions = [30, 110, 260, 340, 420, 500];
        doc.fontSize(10).font('Helvetica-Bold');
        ['NIM', 'Nama', 'Tanggal', 'Masuk', 'Keluar', 'Status'].forEach((header, i) => {
            doc.text(header, columnPositions[i], tableTop);
        });
        doc.moveTo(30, tableTop + 15).lineTo(565, tableTop + 15).stroke();
        doc.font('Helvetica');

        let y = tableTop + 20;
        rows.forEach(row => {
            doc.text(row.nim || '-', columnPositions[0], y);
            doc.text(row.nama || '-', columnPositions[1], y);
            doc.text(row.tanggal || '-', columnPositions[2], y);
            doc.text(row.waktu_masuk || '-', columnPositions[3], y);
            doc.text(row.waktu_keluar || '-', columnPositions[4], y);
            doc.text(row.status || '-', columnPositions[5], y);
            y += 20;
            if (y > 750) {
                doc.addPage();
                y = tableTop;
            }
        });
        doc.end();
    } catch (err) {
        console.error('Error exporting attendance to PDF:', err);
        res.status(500).json({ message: 'Server error saat membuat PDF absensi' });
    }
});

module.exports = router;
