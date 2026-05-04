// Side panel entry. Wires commands, installs subscriptions, kicks off the
// initial state fetch.

import { wireCommands } from "./commands.js";
import { installSubscriptions, refresh } from "./subscriptions.js";

wireCommands();
installSubscriptions();
refresh();
