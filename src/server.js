require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const authRoutes = require('./routes/auth.routes');
const adminRoutes = require('./routes/admin.routes');
const jurnalRoutes = require('./routes/jurnal.routes');
const profileRoutes = require('./routes/profile.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const absensiRoutes = require('./routes/absensi.routes');

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

app.get('/', (req, res) => res.json({ message: 'API Jurnal KP aktif' }));

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/jurnals', jurnalRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/absensi', absensiRoutes);

// 404
app.use((req, res) => res.status(404).json({ message: 'Not found' }));

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`Server jalan di http://localhost:${port}`));
