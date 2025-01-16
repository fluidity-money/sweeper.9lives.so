import * as logger from "winston";

export abstract class Logger {
  logger: logger.Logger;
  private source: string;

  constructor() {
    this.logger = logger.createLogger({
      format: logger.format.json(),
      transports: [new logger.transports.Console()],
    });

    this.source = new.target.name;
  }

  info = (message: string) => {
    this.logger.info(`${this.source} - ${message}`);
  };

  error = (message: string) => {
    this.logger.error(`${this.source} - ${message}`);
  };

  warn = (message: string) => {
    this.logger.warn(`${this.source} - ${message}`);
  };

  debug = (message: string) => {
    this.logger.debug(`${this.source} - ${message}`);
  };
}
