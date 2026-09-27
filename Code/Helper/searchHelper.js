import {matchesItemName} from './itemSearch';

export const isMatch = (name, query) => matchesItemName(name, query, true);
