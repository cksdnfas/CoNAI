import { Router } from 'express';
import authRouter from './auth';
import generateRouter from './generate';
import userRouter from './user';
import costRouter from './cost';

const router = Router();

// NAI Authentication routes
router.use('/auth', authRouter);

// NAI Image Generation routes
router.use('/generate', generateRouter);

// NAI User Data routes (Anlas, subscription)
router.use('/user', userRouter);

// NAI Cost Calculation routes
router.use('/cost', costRouter);

export default router;
