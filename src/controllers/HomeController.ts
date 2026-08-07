import { IncomingMessage, ServerResponse } from "node:http";
import { HomeService } from "../service/HomeService.js";

export class HomeController{
    private homeService:  HomeService;

    constructor()  {
        this.homeService = new HomeService();
    }

    handle(req: IncomingMessage, res: ServerResponse) {
        const html = this.homeService.getHomePage();
        res.writeHead(200, { 'content-type': 'text/html'});
        res.end(html);
    }
}