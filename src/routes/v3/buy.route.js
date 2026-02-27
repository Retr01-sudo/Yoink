import { Router } from "express";
import { buyController } from "../../controllers/v3/buy.controller.js";

const router = Router();

router.post("/buy",buyController.createOrder);

export default router;
