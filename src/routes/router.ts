import { IncomingMessage, ServerResponse } from "node:http";
import { HomeController } from "../controllers/HomeController.js";


const homeController = new HomeController();


export function handleRoutes(
    req: IncomingMessage,
    res: ServerResponse
) {

    const url = req.url;


    if (req.method === "GET" && url === "/") {

        return homeController.handle(req, res);

    }


    res.writeHead(404, {
        "content-type": "application/json"
    });

    res.end(JSON.stringify({
        message: "Route not found"
    }));

}