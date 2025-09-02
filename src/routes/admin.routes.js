const express = require('express');
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');
const pool = require('../config/db');
const { authenticate, authorize } = require('../middlewares/auth');

const router = express.Router();

// Middleware: Only admin can access these routes
router.use(authenticate, authorize('ADMIN'));

// Constants
const VALID_ROLES = ['MAHASISWA', 'ADMIN'];
const VALID_JURNAL_STATUSES = ['APPROVED', 'REJECTED'];

// Helper functions
const handleError = (res, error, message = 'Server error', statusCode = 500) => {
  console.error(error);
  res.status(statusCode).json({ message });
};

const validateRequiredFields = (fields, data) => {
  const missing = fields.filter(field => !data[field]);
  return missing.length ? `Required fields missing: ${missing.join(', ')}` : null;
};

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
        a.*, 
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
      return res.status(404).json({ message: 'No attendance data found' });
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

module.exports = router;
