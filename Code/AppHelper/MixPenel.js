import { Mixpanel } from "mixpanel-react-native";

const trackAutomaticEvents = true;
export const mixpanel = new Mixpanel("d09abb03cee5f7c89d5f11a1f21ce499", trackAutomaticEvents);
mixpanel.init();

