import { Router } from "express";
import { buyController } from "../../controllers/v1_v2/buy.controller.js";

const router = Router();

router.post("/v1/buy",buyController.createOrder);
router.post("/v2/buy",buyController.createOrder);

export default router;
