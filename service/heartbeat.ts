import axios from "axios";
import { Config } from "../types/config";
import { sleep } from "./utils";

export const heartbeat = async (config: Config) => {
  while (true) {
    await axios.get(config.HEARTBEAT_URL);
    await sleep(config.HEARTBEAT_INTERVAL);
  }
};
