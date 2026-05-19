/**
 * @fileoverview Pino logger instance for internal/debug logging.
 * Default level is 'silent' to suppress Baileys internals.
 * Set LOG_LEVEL=debug in .env for verbose output during development.
 * @module utils/log/logger
 */

import pino from "pino";
import config from "#config";

/** @type {import('pino').Logger} */
const logger = pino({ level: config.logLevel });

export default logger;
