
const ADOPTME_NAMES = [
  // Pets / cute
  'Shadow',
  'Frost',
  'NeonFox',
  'MegaOwl',
  'BatDrag',
  'Giraffe',
  'Parrot',
  'Crow',
  'EvilUni',
  'Uni',
  'Kitsune',
  'Cerberus',
  'Phoenix',
  'Griffin',
  'Dragon',
  'Dodo',
  'Trex',
  'Kanga',
  'Turtle',
  'Albino',
  'Arctic',
  'Golden',
  'Diamond',

  // Trading vibes
  'WFL',
  'BigWin',
  'Lose',
  'Overpay',
  'FairDeal',
  'TradeKing',
  'TradeQueen',
  'ValuePro',
  'SwapMaster',
  'OfferUp',

  // Short gamer tags
  'AdoptPro',
  'PetLord',
  'NeonHub',
  'MegaMode',
  'EggHatch',
  'StarTrader',
  'Frosty',
  'ShadowX',
  'OwlGang',
  'UniVibes',
  'PetFlex',
  'TradeX',
  'HatchX',
  'NeonX',
  'MegaX',
];

  

  export const generateOnePieceUsername = () => {
    const randomName = ONE_PIECE_CHARACTERS[Math.floor(Math.random() * ONE_PIECE_CHARACTERS.length)];
    const randomNumber = Math.floor(100 + Math.random() * 900); // Random 4-digit number
    return `${randomName}_${randomNumber}`;
  };
  

  
  
  