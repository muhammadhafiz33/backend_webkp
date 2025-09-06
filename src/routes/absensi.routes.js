const express = require('express');
const pool = require('../config/db');
const { authenticate, authorize } = require('../middlewares/auth');
const PDFDocument = require('pdfkit');
const bcrypt = require('bcryptjs');

const router = express.Router();

// Helper functions
const handleError = (res, error, message = 'Server error', statusCode = 500) => {
  console.error(error);
  res.status(statusCode).json({ message });
};

const validateRequiredFields = (fields, data) => {
  const missing = fields.filter(field => !data[field]);
  return missing.length ? `Required fields missing: ${missing.join(', ')}` : null;
};

// ======================================================
// RUTE UNTUK MAHASISWA
// Rute di bawah ini hanya memerlukan autentikasi token
// ======================================================
router.use(authenticate);

// Endpoint status absensi hari ini
router.get('/status', async (req, res) => {
  try {
    const userId = req.user.id;
    const today = new Date().toISOString().slice(0, 10);
    const [absensi] = await pool.query(
      'SELECT id, tanggal, waktu_masuk, waktu_keluar, status FROM absensi WHERE user_id = ? AND tanggal = ?',
      [userId, today]
    );

    if (absensi.length > 0) {
      return res.json({
        status: 'checked_in',
        data: absensi[0],
      });
    }

    const [izin] = await pool.query(
      'SELECT id, tanggal_izin, alasan FROM izin WHERE user_id = ? AND tanggal_izin = ?',
      [userId, today]
    );

    if (izin.length > 0) {
      return res.json({
        status: 'izin',
        data: izin[0],
      });
    }

    res.json({
      status: 'not_checked_in',
      data: null,
    });
  } catch (error) {
    handleError(res, error, 'Error fetching status');
  }
});

// Endpoint riwayat absensi 5 hari terakhir
router.get('/history', async (req, res) => {
  try {
    const userId = req.user.id;
    const [history] = await pool.query(
      'SELECT id, tanggal, waktu_masuk, waktu_keluar, status FROM absensi WHERE user_id = ? ORDER BY tanggal DESC LIMIT 5',
      [userId]
    );
    res.json(history);
  } catch (error) {
    handleError(res, error, 'Error fetching history');
  }
});

// Endpoint riwayat pengajuan izin 5 hari terakhir
router.get('/izin/history', async (req, res) => {
  try {
    const userId = req.user.id;
    const [izinHistory] = await pool.query(
      'SELECT id, tanggal_izin, alasan FROM izin WHERE user_id = ? ORDER BY tanggal_izin DESC LIMIT 5',
      [userId]
    );
    res.json(izinHistory);
  } catch (error) {
    handleError(res, error, 'Error fetching izin history');
  }
});

// Endpoint untuk Check-in
router.post('/check-in', async (req, res) => {
  try {
    const userId = req.user.id;
    const today = new Date().toISOString().slice(0, 10);
    
    // Perbaikan: Menggunakan format ISOString untuk menjamin format 'HH:mm:ss' yang benar
    const checkInTime = new Date().toISOString().slice(11, 19);

    const status = checkInTime > '08:30:00' ? 'TERLAMBAT' : 'HADIR';

    // Cek apakah user sudah check-in atau mengajukan izin hari ini
    const [existingAbsensi] = await pool.query(
      "SELECT id FROM absensi WHERE user_id = ? AND tanggal = ?",
      [userId, today]
    );
    if (existingAbsensi.length > 0) {
        return res.status(409).json({ message: "Anda sudah check-in hari ini." });
    }

    const [existingIzin] = await pool.query(
      "SELECT id FROM izin WHERE user_id = ? AND tanggal_izin = ?",
      [userId, today]
    );
    if (existingIzin.length > 0) {
        return res.status(409).json({ message: "Anda tidak dapat check-in karena sudah mengajukan izin hari ini." });
    }
    
    // Perbaikan: Menyesuaikan jumlah placeholder dengan parameter
    await pool.query(
      'INSERT INTO absensi (user_id, tanggal, waktu_masuk, status) VALUES (?, ?, ?, ?)',
      [userId, today, checkInTime, status]
    );

    res.status(201).json({ message: 'Check-in berhasil' });
  } catch (error) {
    handleError(res, error, 'Error during check-in');
  }
});

// Endpoint untuk Check-out
router.patch('/check-out', async (req, res) => {
  try {
    const userId = req.user.id;
    const today = new Date().toISOString().slice(0, 10);
    
    // Perbaikan: Menggunakan format ISOString untuk menjamin format 'HH:mm:ss' yang benar
    const checkOutTime = new Date().toISOString().slice(11, 19);

    await pool.query(
      'UPDATE absensi SET waktu_keluar = ? WHERE user_id = ? AND tanggal = ?',
      [checkOutTime, userId, today]
    );

    res.json({ message: 'Check-out berhasil' });
  } catch (error) {
    handleError(res, error, 'Error during check-out');
  }
});

// Endpoint untuk Pengajuan Izin
router.post('/izin', async (req, res) => {
  try {
    const userId = req.user.id;
    const { tanggal_izin, alasan } = req.body;

    if (!tanggal_izin || !alasan) {
      return res.status(400).json({ message: 'Tanggal dan alasan izin harus diisi.' });
    }
    
    // Cek apakah user sudah check-in atau mengajukan izin di tanggal tersebut
    const [existingAbsensi] = await pool.query(
      "SELECT id FROM absensi WHERE user_id = ? AND tanggal = ?",
      [userId, tanggal_izin]
    );
    if (existingAbsensi.length > 0) {
      return res.status(409).json({ message: "Anda sudah check-in di tanggal ini, tidak bisa mengajukan izin." });
    }

    const [existingIzin] = await pool.query(
      "SELECT id FROM izin WHERE user_id = ? AND tanggal_izin = ?",
      [userId, tanggal_izin]
    );
    if (existingIzin.length > 0) {
      return res.status(409).json({ message: "Anda sudah mengajukan izin di tanggal ini." });
    }

    await pool.query(
      'INSERT INTO izin (user_id, tanggal_izin, alasan, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())',
      [userId, tanggal_izin, alasan]
    );

    res.status(201).json({ message: 'Pengajuan izin berhasil' });
  } catch (error) {
    handleError(res, error, 'Error submitting izin');
  }
});

// ======================================================
// RUTE UNTUK ADMIN
// Rute di bawah ini dilindungi dengan otorisasi ADMIN
// ======================================================
router.use(authorize('ADMIN'));

// Constants
const VALID_ROLES = ['MAHASISWA', 'ADMIN'];
const VALID_JURNAL_STATUSES = ['APPROVED', 'REJECTED'];

/** === USER MANAGEMENT === */

// Get all MAHASISWA users
router.get('/users', async (req, res) => {
    try {
        const query = `
            SELECT 
                u.id, 
                u.identifier AS nim, 
                u.email,
                COALESCE(p.nama_lengkap, u.nama_lengkap) AS nama_lengkap,
                p.telepon, 
                p.jurusan, 
                p.divisi,
                p.angkatan
            FROM users u
            LEFT JOIN user_profiles p ON u.id = p.user_id
            WHERE u.role = 'MAHASISWA'
            ORDER BY u.id DESC
        `;
        
        const [rows] = await pool.query(query);
        res.json(rows);
    } catch (error) {
        handleError(res, error, 'Error fetching users');
    }
});

// Get single user by NIM
router.get('/users/:nim', async (req, res) => {
    try {
        const { nim } = req.params;
        
        const query = `
            SELECT 
                u.identifier AS nim, 
                u.email, 
                COALESCE(p.nama_lengkap, u.nama_lengkap) AS nama_lengkap,
                p.foto_profil_url,
                p.telepon,
                p.alamat,
                p.universitas,
                p.fakultas,
                p.jurusan,
                p.angkatan,
                p.ipk,
                p.sks,
                p.divisi,
                p.pembimbing_lapangan,
                p.tanggal_mulai_kp,
                p.tanggal_selesai_kp,
                p.tanggal_lahir
            FROM users u
            LEFT JOIN user_profiles p ON u.id = p.user_id
            WHERE u.identifier = ? AND u.role = 'MAHASISWA'
        `;
        
        const [rows] = await pool.query(query, [nim]);
        
        if (!rows.length) {
            return res.status(404).json({ message: 'Student profile not found' });
        }
        
        res.json(rows[0]);
    } catch (error) {
        handleError(res, error, 'Error fetching user profile');
    }
});

// Create new user
router.post('/users', async (req, res) => {
    try {
        const { identifier, email = null, password, role = 'MAHASISWA', nama_lengkap = null } = req.body || {};
        
        // Validation
        const validationError = validateRequiredFields(['identifier', 'password'], req.body);
        if (validationError) {
            return res.status(400).json({ message: validationError });
        }
        
        if (!VALID_ROLES.includes(role)) {
            return res.status(400).json({ message: 'Invalid role' });
        }

        // Check if user already exists
        const [existingUser] = await pool.query(
            'SELECT id FROM users WHERE identifier = ? OR (email IS NOT NULL AND email = ?)',
            [identifier, email]
        );
        
        if (existingUser.length) {
            return res.status(409).json({ message: 'Identifier or email already exists' });
        }

        // Create user
        const hashedPassword = await bcrypt.hash(password, 10);
        await pool.query(
            'INSERT INTO users (identifier, email, password_hash, role, nama_lengkap) VALUES (?, ?, ?, ?, ?)',
            [identifier, email, hashedPassword, role, nama_lengkap]
        );

        res.status(201).json({ message: 'User created successfully' });
    } catch (error) {
        handleError(res, error, 'Error creating user');
    }
});

// Delete MAHASISWA user
router.delete('/users/:nim', async (req, res) => {
    try {
        const { nim } = req.params;
        
        const [result] = await pool.query(
            'DELETE FROM users WHERE identifier = ? AND role = ?',
            [nim, 'MAHASISWA']
        );

        if (!result.affectedRows) {
            return res.status(404).json({ message: 'Student not found or cannot be deleted' });
        }

        res.json({ message: 'Student deleted successfully' });
    } catch (error) {
        handleError(res, error, 'Error deleting user');
    }
});


/** === JOURNAL MANAGEMENT === */

// Get all journals
router.get('/jurnals', async (req, res) => {
  try {
    const query = `
      SELECT 
        j.*, 
        u.identifier AS nim, 
        COALESCE(p.nama_lengkap, u.nama_lengkap) AS nama_lengkap
      FROM jurnals j
      JOIN users u ON j.user_id = u.id
      LEFT JOIN user_profiles p ON u.id = p.user_id
      ORDER BY j.tanggal DESC, j.created_at DESC
    `;
    
    const [rows] = await pool.query(query);
    res.json(rows);
  } catch (error) {
    handleError(res, error, 'Error fetching journals');
  }
});

// Update journal status
router.patch('/jurnals/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, komentar_admin } = req.body;

    if (!VALID_JURNAL_STATUSES.includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    await pool.query(
      'UPDATE jurnals SET status = ?, komentar_admin = ? WHERE id = ?',
      [status, komentar_admin || null, id]
    );

    res.json({ message: 'Journal status updated successfully' });
  } catch (error) {
    handleError(res, error, 'Error updating journal status');
  }
});

// Export journals to PDF
router.get('/jurnals/export', async (req, res) => {
  try {
    const query = `
      SELECT 
        u.identifier AS nim, 
        COALESCE(p.nama_lengkap, u.nama_lengkap) AS nama,
        DATE_FORMAT(j.tanggal, '%d-%m-%Y') AS tanggal, 
        j.kegiatan, 
        j.status
      FROM jurnals j
      JOIN users u ON j.user_id = u.id
      LEFT JOIN user_profiles p ON u.id = p.user_id
      ORDER BY j.tanggal DESC
    `;
    
    const [rows] = await pool.query(query);

    if (!rows.length) {
      return res.status(404).json({ message: 'No journal data found' });
    }

    // Generate PDF
    const doc = new PDFDocument({ margin: 30, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=laporan-jurnal.pdf');
    doc.pipe(res);

    // PDF Header
    doc.fontSize(16)
       .text('Student Activity Journal Report', { align: 'center' })
       .moveDown();

    // Table configuration
    const headers = ['NIM', 'Name', 'Date', 'Activity', 'Status'];
    const columnPositions = [30, 110, 230, 300, 500];
    const columnWidths = [80, 120, 70, 200, 60];
    const tableTop = 100;

    // Table headers
    doc.fontSize(10).font('Helvetica-Bold');
    headers.forEach((header, i) => {
      doc.text(header, columnPositions[i], tableTop);
    });
    
    doc.moveTo(30, tableTop + 15)
       .lineTo(565, tableTop + 15)
       .stroke();
    
    doc.font('Helvetica');

    // Table rows
    let y = tableTop + 20;
    for (const row of rows) {
      const cells = [
        row.nim || '-',
        row.nama || '-', 
        row.tanggal || '-',
        row.kegiatan || '-',
        row.status || '-'
      ];

      cells.forEach((cell, i) => {
        doc.text(cell, columnPositions[i], y, { width: columnWidths[i] });
      });

      const rowHeight = Math.max(
        doc.heightOfString(row.kegiatan || '-', { width: columnWidths[3] }), 
        20
      );
      y += rowHeight + 10;

      // Add new page if needed
      if (y > 750) {
        doc.addPage();
        y = tableTop;
      }
    }

    doc.end();
  } catch (error) {
    handleError(res, error, 'Error generating PDF report');
  }
});

/** === ATTENDANCE MANAGEMENT === */

// Get attendance by date
router.get('/absensi', async (req, res) => {
  try {
    const { tanggal } = req.query;
    
    if (!tanggal) {
      return res.status(400).json({ message: 'Date parameter is required' });
    }

    const query = `
      SELECT 
        a.id, a.tanggal, a.waktu_masuk, a.waktu_keluar, a.status,
        u.identifier AS nim, 
        COALESCE(p.nama_lengkap, u.nama_lengkap) AS nama_lengkap
      FROM absensi a
      JOIN users u ON a.user_id = u.id
      LEFT JOIN user_profiles p ON u.id = p.user_id
      WHERE a.tanggal = ?
      ORDER BY u.identifier ASC
    `;
    
    const [rows] = await pool.query(query, [tanggal]);
    res.json(rows);
  } catch (error) {
    handleError(res, error, 'Error fetching attendance');
  }
});

// Export attendance to PDF
router.get('/absensi/export', async (req, res) => {
  try {
    const { tanggal } = req.query;
    
    if (!tanggal) {
      return res.status(400).json({ message: 'Date parameter is required' });
    }

    const query = `
      SELECT 
        u.identifier AS nim, 
        COALESCE(p.nama_lengkap, u.nama_lengkap) AS nama,
        DATE_FORMAT(a.tanggal, '%d-%m-%Y') AS tanggal,
        a.waktu_masuk, 
        a.waktu_keluar, 
        a.status
      FROM absensi a
      JOIN users u ON a.user_id = u.id
      LEFT JOIN user_profiles p ON u.id = p.user_id
      WHERE a.tanggal = ?
      ORDER BY u.identifier ASC
    `;
    
    const [rows] = await pool.query(query, [tanggal]);

    if (!rows.length) {
      // Tidak mengembalikan error jika tidak ada data, tapi membuat PDF kosong
      const doc = new PDFDocument({ margin: 30, size: 'A4' });
      const formattedDate = new Date(tanggal).toLocaleDateString('id-ID', { dateStyle: 'full' });
      
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=laporan-absensi-${tanggal}.pdf`);
      doc.pipe(res);

      doc.fontSize(16).text(`Laporan Absensi - ${formattedDate}`, { align: 'center' }).moveDown();
      doc.fontSize(12).text('Tidak ada data absensi untuk tanggal ini.', { align: 'center' }).moveDown();
      doc.end();
      return;
    }

    // Generate PDF
    const doc = new PDFDocument({ margin: 30, size: 'A4' });
    const formattedDate = new Date(tanggal).toLocaleDateString('id-ID', { dateStyle: 'full' });
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=laporan-absensi-${tanggal}.pdf`);
    doc.pipe(res);

    // PDF Header
    doc.fontSize(16)
       .text(`Attendance Report - ${formattedDate}`, { align: 'center' })
       .moveDown();

    // Table configuration
    const headers = ['NIM', 'Name', 'Date', 'Check In', 'Check Out', 'Status'];
    const columnPositions = [30, 110, 260, 340, 420, 500];
    const tableTop = 100;

    // Table headers
    doc.fontSize(10).font('Helvetica-Bold');
    headers.forEach((header, i) => {
      doc.text(header, columnPositions[i], tableTop);
    });
    
    doc.moveTo(30, tableTop + 15)
       .lineTo(565, tableTop + 15)
       .stroke();
    
    doc.font('Helvetica');

    // Table rows
    let y = tableTop + 20;
    for (const row of rows) {
      const cells = [
        row.nim || '-',
        row.nama || '-',
        row.tanggal || '-', 
        row.waktu_masuk || '-',
        row.waktu_keluar || '-',
        row.status || '-'
      ];

      cells.forEach((cell, i) => {
        doc.text(cell, columnPositions[i], y);
      });

      y += 20;
      
      // Add new page if needed
      if (y > 750) {
        doc.addPage();
        y = tableTop;
      }
    }

    doc.end();
  } catch (error) {
    handleError(res, error, 'Error generating attendance PDF report');
  }
});

// GET /api/admin/izin/history -> Mendapatkan semua riwayat pengajuan izin
router.get('/izin/history', async (req, res) => {
    try {
      const [izinHistory] = await pool.query(
        'SELECT i.*, u.identifier AS nim, u.email FROM izin i JOIN users u ON i.user_id = u.id ORDER BY i.tanggal_izin DESC'
      );
      res.json(izinHistory);
    } catch (error) {
      handleError(res, error, 'Error fetching all izin history');
    }
});

/**
 * Endpoint untuk mengekspor riwayat izin ke PDF
 */
router.get('/izin/export/pdf', async (req, res) => {
    try {
        const query = `
            SELECT 
                u.identifier AS nim, 
                COALESCE(p.nama_lengkap, u.nama_lengkap) AS nama,
                i.alasan,
                DATE_FORMAT(i.tanggal_izin, '%d-%m-%Y') AS tanggal_izin,
                i.status
            FROM izin i
            JOIN users u ON i.user_id = u.id
            LEFT JOIN user_profiles p ON u.id = p.user_id
            ORDER BY i.tanggal_izin DESC
        `;
        
        const [rows] = await pool.query(query);

        if (!rows.length) {
            return res.status(404).json({ message: 'No leave request data found' });
        }

        const doc = new PDFDocument({ margin: 30, size: 'A4' });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=laporan-izin-mahasiswa.pdf`);
        doc.pipe(res);

        doc.fontSize(16).text('Laporan Riwayat Pengajuan Izin', { align: 'center' }).moveDown();

        const headers = ['NIM', 'Nama', 'Tanggal Izin', 'Alasan', 'Status'];
        const columnPositions = [30, 110, 230, 320, 500];
        const columnWidths = [80, 120, 90, 170, 60];
        const tableTop = 100;

        doc.fontSize(10).font('Helvetica-Bold');
        headers.forEach((header, i) => {
            doc.text(header, columnPositions[i], tableTop);
        });
        
        doc.moveTo(30, tableTop + 15).lineTo(565, tableTop + 15).stroke();
        
        doc.font('Helvetica');

        let y = tableTop + 20;
        for (const row of rows) {
            const cells = [
                row.nim || '-',
                row.nama || '-',
                row.tanggal_izin || '-', 
                row.alasan || '-',
                row.status || '-'
            ];

            cells.forEach((cell, i) => {
                doc.text(cell, columnPositions[i], y, { width: columnWidths[i] });
            });

            const rowHeight = Math.max(
                doc.heightOfString(row.alasan || '-', { width: columnWidths[3] }), 
                20
            );
            y += rowHeight + 10;

            if (y > 750) {
                doc.addPage();
                y = tableTop;
            }
        }

        doc.end();
    } catch (error) {
        handleError(res, error, 'Error generating leave PDF report');
    }
});


/** === PEMBIMBING MANAGEMENT === */

// GET /api/admin/pembimbing/summary -> Dapatkan daftar pembimbing dengan statistik ringkas
router.get('/pembimbing/summary', async (req, res) => {
  try {
    const query = `
      SELECT 
        u.id, u.identifier, u.email,
        COALESCE(p.nama_lengkap, u.nama_lengkap) AS nama_lengkap,
        (SELECT COUNT(*) FROM user_profiles up WHERE up.pembimbing_lapangan = COALESCE(p.nama_lengkap, u.nama_lengkap)) AS totalMahasiswa,
        (SELECT COUNT(j.id) FROM jurnals j JOIN user_profiles up ON j.user_id = up.user_id WHERE up.pembimbing_lapangan = COALESCE(p.nama_lengkap, u.nama_lengkap) AND j.status = 'PENDING') AS jurnalPending,
        (SELECT COUNT(j.id) FROM jurnals j JOIN user_profiles up ON j.user_id = up.user_id WHERE up.pembimbing_lapangan = COALESCE(p.nama_lengkap, u.nama_lengkap) AND j.status = 'APPROVED') AS jurnalApproved
      FROM users u
      LEFT JOIN user_profiles p ON u.id = p.user_id
      WHERE u.role = 'PEMBIMBING'
      ORDER BY u.id DESC
    `;
    const [rows] = await pool.query(query);
    res.json(rows);
  } catch (error) {
    handleError(res, error, 'Error fetching pembimbing summary');
  }
});

module.exports = router;