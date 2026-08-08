import { createServer } from "http";
import { handleRoutes } from "./routes/router.js";

const PORT = process.env.PORT || 3000;

const server = createServer(async (req, res) => {

    try {
        await handleRoutes(req,res);
    } catch (error) {
        console.error('Unhandled error: ', error);
        res.writeHead(500, {'content-type': 'application/json'});
        res.end(JSON.stringify({ error: 'Internal Server Error'}));

    }
})

server.listen(PORT, () => {
    console.log(`Servidor HTTP nativo corriendo en http://localhost:${PORT}`)
})