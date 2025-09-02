const express = require('express');
const pool = require('../config/db');
const { authenticate, authorize } = require('../middlewares/auth');
const PDFDocument = require('pdfkit');

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
        const columnPositions = [30, 110, 260, 340, 420, 500];
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

        // Tidak mengembalikan error jika tidak ada data, tapi membuat PDF kosong
        if (!rows.length) {
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
           .text(`Laporan Absensi - ${formattedDate}`, { align: 'center' })
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

// RUTE BARU UNTUK EXPORT PDF IZIN
router.get('/izin/export/pdf', async (req, res) => {
    try {
        const [izinData] = await pool.query(
            `SELECT izin.*, users.identifier AS nim, users.email, COALESCE(users_profile.nama_lengkap, users.nama_lengkap) as nama_lengkap, izin.status AS status_izin
             FROM izin 
             JOIN users ON izin.user_id = users.id
             LEFT JOIN user_profiles ON users.id = user_profiles.user_id
             ORDER BY izin.created_at DESC`
        );
        
        if (izinData.length === 0) {
            return res.status(404).json({ message: 'Tidak ada data izin untuk diekspor.' });
        }

        const doc = new PDFDocument({
            size: 'A4',
            margin: 30
        });
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="riwayat_izin_mahasiswa.pdf"');
        doc.pipe(res);

        // --- Header Dokumen ---
        doc.fontSize(20).text('Laporan Pengajuan Izin', { align: 'center' }).moveDown(1);
        
        // --- Setup Tabel ---
        const table = {
            headers: ['No.', 'Tanggal', 'Nama Karyawan', 'Keperluan', 'Jam Keluar', 'Jam Kembali', 'Tanda Tangan'],
            widths: [20, 60, 100, 140, 50, 50, 60],
            positions: [30, 55, 120, 225, 370, 425, 485],
            startY: doc.y,
        };
        const tableRight = table.positions[0] + table.widths.reduce((sum, w) => sum + w, 0);

        const drawHeaders = (doc) => {
            doc.font('Helvetica-Bold').fontSize(8);
            let currentX = table.positions[0];
            table.headers.forEach((header, i) => {
                doc.text(header, currentX, doc.y, { width: table.widths[i], align: 'center' });
                currentX += table.widths[i] + 5;
            });
            doc.moveDown(0.5);
            doc.font('Helvetica');
            doc.moveTo(table.positions[0], doc.y).lineTo(tableRight, doc.y).stroke();
            doc.moveDown(0.2);
        };

        drawHeaders(doc);
        let currentY = doc.y;

        izinData.forEach((item, index) => {
            const rowStart = currentY;

            // Mengukur tinggi teks terpanjang dalam baris
            const textKeperluan = item.alasan || '-';
            const keperluanHeight = doc.heightOfString(textKeperluan, { width: table.widths[3] });
            const rowHeight = Math.max(20, keperluanHeight + 10);

            // Menambah halaman baru jika baris berikutnya tidak muat
            if (currentY + rowHeight > doc.page.height - 50) {
                doc.addPage();
                doc.y = table.startY;
                drawHeaders(doc);
                currentY = doc.y;
            }

            // Menggambar data baris
            doc.font('Helvetica').fontSize(8);
            doc.text(`${index + 1}`, table.positions[0], currentY + 5, { width: table.widths[0], align: 'center' });
            doc.text(new Date(item.tanggal_izin).toLocaleDateString('id-ID'), table.positions[1], currentY + 5, { width: table.widths[1], align: 'left' });
            doc.text(item.nama_lengkap || '-', table.positions[2], currentY + 5, { width: table.widths[2], align: 'left' });
            doc.text(textKeperluan, table.positions[3], currentY + 5, { width: table.widths[3], align: 'left' });
            doc.text('08:00', table.positions[4], currentY + 5, { width: table.widths[4], align: 'center' }); // Data placeholder
            doc.text('17:00', table.positions[5], currentY + 5, { width: table.widths[5], align: 'center' }); // Data placeholder
            doc.text('', table.positions[6], currentY + 5, { width: table.widths[6], align: 'center' }); // Placeholder untuk tanda tangan

            // Menggambar garis horizontal di bawah baris
            doc.moveTo(table.positions[0], currentY + rowHeight).lineTo(tableRight, currentY + rowHeight).stroke();
            
            // Menggambar garis vertikal untuk setiap kolom
            let lineX = table.positions[0];
            doc.moveTo(lineX, currentY).lineTo(lineX, currentY + rowHeight).stroke();
            lineX += table.widths[0];
            doc.moveTo(lineX, currentY).lineTo(lineX, currentY + rowHeight).stroke();
            lineX += table.widths[1];
            doc.moveTo(lineX, currentY).lineTo(lineX, currentY + rowHeight).stroke();
            lineX += table.widths[2];
            doc.moveTo(lineX, currentY).lineTo(lineX, currentY + rowHeight).stroke();
            lineX += table.widths[3];
            doc.moveTo(lineX, currentY).lineTo(lineX, currentY + rowHeight).stroke();
            lineX += table.widths[4];
            doc.moveTo(lineX, currentY).lineTo(lineX, currentY + rowHeight).stroke();
            lineX += table.widths[5];
            doc.moveTo(lineX, currentY).lineTo(lineX, currentY + rowHeight).stroke();
            lineX += table.widths[6];
            doc.moveTo(lineX, currentY).lineTo(lineX, currentY + rowHeight).stroke();

            currentY += rowHeight;
        });

        doc.end();

    } catch (error) {
        handleError(res, error, 'Error saat ekspor PDF riwayat izin:', error);
    }
});

module.exports = router;