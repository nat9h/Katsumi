import { Client } from "./handlers/Client.js";
import logger, { print } from "./libs/utils/logger.js";

process.on("unhandledRejection", (reason) => {
    print.error(`Unhandled rejection: ${reason}`);
    logger.error({ reason }, "unhandled rejection");
});

process.on("uncaughtException", (err) => {
    print.fatal(`Uncaught exception: ${err.message}`);
    logger.fatal({ err }, "uncaught exception");
    process.exit(1);
});

new Client().start().catch((err) => {
    print.fatal(`Startup error: ${err.message}`);
    process.exit(1);
});
