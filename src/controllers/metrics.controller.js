import metricsService from "../services/metrics.service.js";

const getMetrics = async (req,res,next)=>{
    try{
        res.setHeader('Content-Type', await metricsService.getMetricsContentType()); //it tells client what is the type of data that is being transmitted
        res.send(await metricsService.getMetrics());
    }
    catch(err){
        res.status(500).send(err.message);
    }
}

export const metricsController = {
    getMetrics
};
