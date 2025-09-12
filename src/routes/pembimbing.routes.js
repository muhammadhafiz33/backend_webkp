const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { authenticate, authorize } = require('../middlewares/auth');
const PDFDocument = require('pdfkit');

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
        
        // Perbaikan: Menambahkan lebih banyak kolom dari tabel user_profiles
        const query = `
            SELECT 
                u.id, 
                u.identifier AS nim, 
                COALESCE(p.nama_lengkap, u.nama_lengkap) AS nama_lengkap, 
                p.jurusan, 
                u.email, 
                p.telepon, 
                p.divisi,
                p.universitas,
                p.angkatan,
                p.pembimbing_lapangan,
                p.tanggal_mulai_kp,
                p.tanggal_selesai_kp
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
 * Endpoint BARU untuk memperbarui status jurnal oleh pembimbing.
 */
router.patch('/jurnals/:jurnalId/status', async (req, res) => {
    try {
        const { jurnalId } = req.params;
        const { status, komentar_admin } = req.body;
        const pembimbingUserId = req.user.id;

        // Validasi status
        const validStatuses = ['APPROVED', 'REJECTED'];
        if (!validStatuses.includes(status.toUpperCase())) {
            return res.status(400).json({ message: 'Invalid status provided.' });
        }

        // Dapatkan nama pembimbing
        const [pembimbingInfo] = await pool.query(
            `SELECT COALESCE(p.nama_lengkap, u.nama_lengkap) AS nama_lengkap 
             FROM users u LEFT JOIN user_profiles p ON u.id = p.user_id 
             WHERE u.id = ?`,
            [pembimbingUserId]
        );
        if (!pembimbingInfo.length) {
            return res.status(404).json({ message: 'Pembimbing not found.' });
        }
        const namaPembimbing = pembimbingInfo[0].nama_lengkap;

        // Verifikasi bahwa jurnal ini milik salah satu mahasiswa bimbingan dari pembimbing ini
        const [jurnal] = await pool.query(
            `SELECT j.id FROM jurnals j
             JOIN user_profiles up ON j.user_id = up.user_id
             WHERE j.id = ? AND up.pembimbing_lapangan = ?`,
            [jurnalId, namaPembimbing]
        );

        if (jurnal.length === 0) {
            return res.status(403).json({ message: 'Forbidden: You are not authorized to update this journal.' });
        }

        // Update jurnal
        await pool.query(
            'UPDATE jurnals SET status = ?, komentar_admin = ? WHERE id = ?',
            [status.toUpperCase(), komentar_admin || null, jurnalId]
        );

        res.json({ message: 'Journal status updated successfully.' });

    } catch (error) {
        console.error('Error updating journal status by pembimbing:', error);
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
        
        // Perbaikan: Query digabung untuk mengambil data absensi dan izin
        const query = `
            SELECT 
                a.id, a.tanggal, a.waktu_masuk, a.waktu_keluar, a.status, NULL as alasan,
                u.identifier AS nim_mahasiswa,
                COALESCE(up.nama_lengkap, u.nama_lengkap) AS nama_mahasiswa
            FROM absensi a
            JOIN users u ON a.user_id = u.id
            LEFT JOIN user_profiles up ON u.id = up.user_id
            WHERE up.pembimbing_lapangan = ?
            UNION ALL
            SELECT 
                i.id, i.tanggal_izin as tanggal, NULL as waktu_masuk, NULL as waktu_keluar, 'IZIN' as status, i.alasan,
                u.identifier AS nim_mahasiswa,
                COALESCE(up.nama_lengkap, u.nama_lengkap) AS nama_mahasiswa
            FROM izin i
            JOIN users u ON i.user_id = u.id
            LEFT JOIN user_profiles up ON u.id = up.user_id
            WHERE up.pembimbing_lapangan = ?
            ORDER BY tanggal DESC
        `;
        const [absensi] = await pool.query(query, [namaPembimbing, namaPembimbing]);

        res.json(absensi);
    } catch (error) {
        console.error('Error fetching absensi for pembimbing:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

/**
 * Endpoint untuk mengekspor laporan absensi pembimbing ke PDF
 */
router.get('/absensi/export/pdf', async (req, res) => {
    try {
        const userId = req.user.id;
        const [pembimbingInfo] = await pool.query(
            `SELECT COALESCE(p.nama_lengkap, u.nama_lengkap) AS nama_lengkap
             FROM users u LEFT JOIN user_profiles p ON u.id = p.user_id
             WHERE u.id = ? AND u.role = 'PEMBIMBING'`,
            [userId]
        );

        if (!pembimbingInfo.length) {
            return res.status(404).json({ message: 'Pembimbing not found' });
        }
        
        const namaPembimbing = pembimbingInfo[0].nama_lengkap;
        
        const query = `
            SELECT 
                u.identifier AS nim_mahasiswa,
                COALESCE(up.nama_lengkap, u.nama_lengkap) AS nama_mahasiswa,
                a.tanggal, a.waktu_masuk, a.waktu_keluar, a.status
            FROM absensi a
            JOIN users u ON a.user_id = u.id
            LEFT JOIN user_profiles up ON u.id = up.user_id
            WHERE up.pembimbing_lapangan = ?
            ORDER BY a.tanggal DESC
        `;
        const [rows] = await pool.query(query, [namaPembimbing]);

        if (!rows.length) {
            const doc = new PDFDocument({ margin: 30, size: 'A4' });
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename=laporan-absensi-bimbingan.pdf`);
            doc.pipe(res);
            doc.fontSize(16).text('Laporan Absensi Mahasiswa Bimbingan', { align: 'center' }).moveDown();
            doc.fontSize(12).text('Tidak ada data absensi untuk mahasiswa bimbingan.', { align: 'center' }).moveDown();
            doc.end();
            return;
        }

        const doc = new PDFDocument({ margin: 30, size: 'A4' });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=laporan-absensi-bimbingan.pdf`);
        doc.pipe(res);

        doc.fontSize(16).text('Laporan Absensi Mahasiswa Bimbingan', { align: 'center' }).moveDown();
        doc.fontSize(12).text(`Pembimbing: ${namaPembimbing}`).moveDown();

        const headers = ['NIM', 'Nama', 'Tanggal', 'Masuk', 'Keluar', 'Status'];
        const columnPositions = [30, 100, 230, 320, 400, 500];
        const columnWidths = [70, 130, 90, 80, 80, 60];
        let tableTop = 150;

        doc.fontSize(10).font('Helvetica-Bold');
        headers.forEach((header, i) => doc.text(header, columnPositions[i], tableTop, { width: columnWidths[i] }));
        doc.moveTo(30, tableTop + 15).lineTo(565, tableTop + 15).stroke();
        doc.font('Helvetica');

        let y = tableTop + 20;
        for (const row of rows) {
            if (y > 750) {
                doc.addPage();
                y = 50;
            }

            const cells = [
                row.nim_mahasiswa || '-',
                row.nama_mahasiswa || '-',
                new Date(row.tanggal).toLocaleDateString('id-ID') || '-',
                row.waktu_masuk || '-',
                row.waktu_keluar || '-',
                row.status || '-'
            ];

            cells.forEach((cell, i) => doc.text(cell, columnPositions[i], y, { width: columnWidths[i] }));
            y += 20;
        }

        doc.end();
    } catch (error) {
        console.error('Error generating PDF report for pembimbing:', error);
        res.status(500).json({ message: 'Error generating PDF report' });
    }
});


/**
 * Endpoint BARU untuk mengekspor laporan jurnal pembimbing ke PDF
 */
router.get('/jurnals/export/pdf', async (req, res) => {
    try {
        const userId = req.user.id;
        const [pembimbingInfo] = await pool.query(
            `SELECT COALESCE(p.nama_lengkap, u.nama_lengkap) AS nama_lengkap
             FROM users u LEFT JOIN user_profiles p ON u.id = p.user_id
             WHERE u.id = ? AND u.role = 'PEMBIMBING'`,
            [userId]
        );

        if (!pembimbingInfo.length) {
            return res.status(404).json({ message: 'Pembimbing not found' });
        }
        
        const namaPembimbing = pembimbingInfo[0].nama_lengkap;
        
        const query = `
            SELECT 
                j.id,
                u.identifier AS nim, 
                COALESCE(p.nama_lengkap, u.nama_lengkap) AS nama,
                j.tanggal, 
                j.kegiatan, 
                j.deskripsi,
                j.jam_kerja,
                j.hambatan,
                j.rencana_selanjutnya,
                j.status,
                j.komentar_admin
            FROM jurnals j
            JOIN users u ON j.user_id = u.id
            LEFT JOIN user_profiles p ON u.id = p.user_id
            WHERE COALESCE(p.pembimbing_lapangan, '') = ?
            ORDER BY j.tanggal DESC
        `;
        
        const [rows] = await pool.query(query, [namaPembimbing]);

        if (!rows.length) {
            const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename=laporan-jurnal-bimbingan.pdf`);
            doc.pipe(res);
            doc.fontSize(16).text('Laporan Jurnal Mahasiswa Bimbingan', { align: 'center' }).moveDown();
            doc.fontSize(12).text('Tidak ada data jurnal untuk mahasiswa bimbingan.', { align: 'center' }).moveDown();
            doc.end();
            return;
        }

        const doc = new PDFDocument({ margin: 50, layout: 'landscape', size: 'A4' });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=laporan-jurnal-bimbingan.pdf`);
        doc.pipe(res);
        
        rows.forEach((jurnal, index) => {
            const formattedDate = new Date(jurnal.tanggal).toLocaleDateString('id-ID', { dateStyle: 'full' });
            
            // Header
            doc.fontSize(12).font('Helvetica-Bold').text('Nama Pembimbing:', 50, 50).font('Helvetica').text(namaPembimbing, 160, 50);
            
            doc.font('Helvetica-Bold').text('Nama Mahasiswa:', 500, 50).font('Helvetica').text(`${jurnal.nama} (${jurnal.nim})`, 610, 50);
            doc.font('Helvetica-Bold').text('Tanggal:', 500, 65).font('Helvetica').text(formattedDate, 610, 65);

            doc.moveDown(4);

            // Body
            const bodyY = doc.y;
            const contentX = 50;
            const labelWidth = 80;
            const valueX = contentX + labelWidth;
            
            doc.font('Helvetica-Bold').text('Kegiatan:', contentX, bodyY, { width: labelWidth });
            doc.font('Helvetica').text(jurnal.kegiatan || '-', valueX, bodyY, { width: 600 });
            doc.moveDown(1);
            doc.font('Helvetica-Bold').text('Deskripsi:', contentX, doc.y, { width: labelWidth });
            doc.font('Helvetica').text(jurnal.deskripsi || '-', valueX, doc.y, { width: 600 });
            doc.moveDown(1);
            doc.font('Helvetica-Bold').text('Hambatan:', contentX, doc.y, { width: labelWidth });
            doc.font('Helvetica').text(jurnal.hambatan || '-', valueX, doc.y, { width: 600 });
            doc.moveDown(1);
            doc.font('Helvetica-Bold').text('Rencana:', contentX, doc.y, { width: labelWidth });
            doc.font('Helvetica').text(jurnal.rencana_selanjutnya || '-', valueX, doc.y, { width: 600 });
           
            // Status di kanan bawah
            const statusY = doc.page.height - 70;
            doc.font('Helvetica-Bold').text('Status:', 650, statusY);
            doc.save();
            if (jurnal.status === 'APPROVED') {
                // Gambar ikon centang
                doc.moveTo(700, statusY + 5).lineTo(705, statusY + 10).lineTo(715, statusY).lineWidth(2).stroke('green');
            } else {
                doc.font('Helvetica').fillColor('black').text(jurnal.status, 700, statusY);
            }
            doc.restore();
            
            // Tambahkan halaman baru jika bukan jurnal terakhir
            if (index < rows.length - 1) {
                doc.addPage({ margin: 50, layout: 'landscape', size: 'A4' });
            }
        });

        doc.end();
    } catch (error) {
        console.error('Error generating PDF report for journals:', error);
        res.status(500).json({ message: 'Error generating PDF report' });
    }
});

/**
 * Endpoint BARU untuk mengekspor laporan izin pembimbing ke PDF
 */
router.get('/izin/export/pdf', async (req, res) => {
    try {
        const userId = req.user.id;
        const [pembimbingInfo] = await pool.query(
            `SELECT COALESCE(p.nama_lengkap, u.nama_lengkap) AS nama_lengkap
             FROM users u LEFT JOIN user_profiles p ON u.id = p.user_id
             WHERE u.id = ? AND u.role = 'PEMBIMBING'`,
            [userId]
        );

        if (!pembimbingInfo.length) {
            return res.status(404).json({ message: 'Pembimbing not found' });
        }
        
        const namaPembimbing = pembimbingInfo[0].nama_lengkap;
        
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
            WHERE p.pembimbing_lapangan = ?
            ORDER BY i.tanggal_izin DESC
        `;
        
        const [rows] = await pool.query(query, [namaPembimbing]);

        if (!rows.length) {
            const doc = new PDFDocument({ margin: 30, size: 'A4' });
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename=laporan-izin-bimbingan.pdf`);
            doc.pipe(res);
            doc.fontSize(16).text('Laporan Riwayat Pengajuan Izin', { align: 'center' }).moveDown();
            doc.fontSize(12).text('Tidak ada data izin untuk mahasiswa bimbingan.', { align: 'center' }).moveDown();
            doc.end();
            return;
        }

        const doc = new PDFDocument({ margin: 30, size: 'A4' });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=laporan-izin-bimbingan.pdf`);
        doc.pipe(res);
        
        doc.fontSize(16).text('Laporan Riwayat Pengajuan Izin', { align: 'center' }).moveDown();
        doc.fontSize(12).text(`Pembimbing: ${namaPembimbing}`).moveDown();
        
        const headers = ['NIM', 'Nama', 'Tanggal Izin', 'Alasan', 'Status'];
        const columnPositions = [30, 110, 230, 320, 500];
        const columnWidths = [80, 120, 90, 170, 60];
        let tableTop = 150;

        doc.fontSize(10).font('Helvetica-Bold');
        headers.forEach((header, i) => doc.text(header, columnPositions[i], tableTop, { width: columnWidths[i] }));
        doc.moveTo(30, tableTop + 15).lineTo(565, tableTop + 15).stroke();
        doc.font('Helvetica');

        let y = tableTop + 20;
        for (const row of rows) {
            if (y > 750) {
                doc.addPage();
                y = 50;
            }

            const cells = [
                row.nim || '-',
                row.nama || '-',
                row.tanggal_izin || '-', 
                row.alasan || '-',
                row.status || '-'
            ];

            cells.forEach((cell, i) => doc.text(cell, columnPositions[i], y, { width: columnWidths[i] }));
            y += 20;
        }

        doc.end();
    } catch (error) {
        console.error('Error generating PDF report for leave requests:', error);
        res.status(500).json({ message: 'Error generating PDF report' });
    }
});

// Endpoint untuk mengunduh jurnal tunggal sebagai PDF
router.get('/jurnals/:jurnalId/export/pdf', async (req, res) => {
    try {
        const { jurnalId } = req.params;
        const userId = req.user.id;
        
        const [pembimbingInfo] = await pool.query(
            `SELECT COALESCE(p.nama_lengkap, u.nama_lengkap) AS nama_lengkap 
             FROM users u LEFT JOIN user_profiles p ON u.id = p.user_id 
             WHERE u.id = ?`, [userId]
        );

        if (!pembimbingInfo.length) {
            return res.status(404).json({ message: 'Pembimbing not found' });
        }
        const namaPembimbing = pembimbingInfo[0].nama_lengkap;
        
        const query = `
            SELECT 
                j.id, u.identifier AS nim, 
                COALESCE(p.nama_lengkap, u.nama_lengkap) AS nama,
                j.tanggal, j.kegiatan, j.deskripsi, j.status,
                p.pembimbing_lapangan
            FROM jurnals j
            JOIN users u ON j.user_id = u.id
            LEFT JOIN user_profiles p ON u.id = p.user_id
            WHERE j.id = ? AND p.pembimbing_lapangan = ?
        `;
        
        const [rows] = await pool.query(query, [jurnalId, namaPembimbing]);

        if (!rows.length) {
            return res.status(404).json({ message: 'Jurnal tidak ditemukan atau Anda tidak berwenang mengaksesnya' });
        }
        
        const jurnal = rows[0];
        const doc = new PDFDocument({ margin: 50, layout: 'landscape', size: 'A4' });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=jurnal-${jurnal.nim}-${new Date(jurnal.tanggal).toISOString().split('T')[0]}.pdf`);
        doc.pipe(res);
        
        // Header
        doc.fontSize(12).font('Helvetica-Bold').text('Nama Pembimbing:', 50, 50).font('Helvetica').text(namaPembimbing, 160, 50);
        
        doc.font('Helvetica-Bold').text('Nama Mahasiswa:', 500, 50).font('Helvetica').text(`${jurnal.nama} (${jurnal.nim})`, 610, 50);
        doc.font('Helvetica-Bold').text('Tanggal:', 500, 65).font('Helvetica').text(new Date(jurnal.tanggal).toLocaleDateString('id-ID', { dateStyle: 'full' }), 610, 65);

        doc.moveDown(4);

        // Body
        const bodyY = doc.y;
        const contentX = 50;
        const labelWidth = 80;
        const valueX = contentX + labelWidth;
        
        doc.font('Helvetica-Bold').text('Kegiatan:', contentX, bodyY, { width: labelWidth });
        doc.font('Helvetica').text(jurnal.kegiatan || '-', valueX, bodyY, { width: 600 });
        doc.moveDown(1);
        doc.font('Helvetica-Bold').text('Deskripsi:', contentX, doc.y, { width: labelWidth });
        doc.font('Helvetica').text(jurnal.deskripsi || '-', valueX, doc.y, { width: 600 });
        doc.moveDown(1);
        doc.font('Helvetica-Bold').text('Hambatan:', contentX, doc.y, { width: labelWidth });
        doc.font('Helvetica').text(jurnal.hambatan || '-', valueX, doc.y, { width: 600 });
        doc.moveDown(1);
        doc.font('Helvetica-Bold').text('Rencana:', contentX, doc.y, { width: labelWidth });
        doc.font('Helvetica').text(jurnal.rencana_selanjutnya || '-', valueX, doc.y, { width: 600 });
       
        // Status di kanan bawah
        const statusY = doc.page.height - 70;
        doc.font('Helvetica-Bold').text('Status:', 650, statusY);
        doc.save();
        if (jurnal.status === 'APPROVED') {
            // Gambar ikon centang
            doc.moveTo(700, statusY + 5).lineTo(705, statusY + 10).lineTo(715, statusY).lineWidth(2).stroke('green');
        } else {
            doc.font('Helvetica').fillColor('black').text(jurnal.status, 700, statusY);
        }
        doc.restore();
        
        doc.end();

    } catch (error) {
        console.error('Error exporting single journal:', error);
        res.status(500).json({ message: 'Gagal mengekspor jurnal' });
    }
});

module.exports = router;

