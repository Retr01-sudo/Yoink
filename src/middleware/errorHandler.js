import dotenv from "dotenv";

dotenv.config();

const isDev = process.env.NODE_ENV !== "production";

const errorHandler = (err, req, res, next) => {
    console.error("Error:", err);

    if (err.message === "Not allowed by CORS") {
        return res.status(403).json({
            error: "CORS Error",
            message: "Origin not allowed",
        });
    }

    res.status(err.status || 500).json({
        error: err.name || "Internal Server Error",
        message: err.message || "Something went wrong",
        ...(isDev && { stack: err.stack }),
    });
};

export default errorHandler;
