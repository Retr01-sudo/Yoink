import { Router } from "express";
import { buyController } from "../controllers/buy.controller.js";

const router = Router();

router.post("/",buyController.createOrder);

export default router;
