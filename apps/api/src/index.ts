import express from 'express';
import cors from 'cors';
import { env } from './config/env.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { studentRouter } from './routes/student.js';
import { staffRouter } from './routes/staff.js';
import { academicRouter } from './routes/academic.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

const app = express();

app.use(cors({ origin: env.CORS_ORIGIN }));
app.use(express.json());

app.use('/api', healthRouter);
app.use('/api', authRouter);
app.use('/api', studentRouter);
app.use('/api', staffRouter);
app.use('/api', academicRouter);

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(env.PORT, '0.0.0.0', () => {
  console.log(`gcrs-api listening on port ${env.PORT}`);
});
