import { Platform } from "react-native";

const isNoman = true; // Toggle this to switch configurations

// noman app id = ca-app-pub-5740215782746766~5357820183
//waqas app id = ca-app-pub-3701208411582706~4267174419
// noman pkgName= com.adoptmevaluescalc
//waqas pkgName = com.bloxfruitstock
const rev_cat_id = Platform.OS === 'ios' ? 'appl_fJWiaIgCJxAeJnMeDtvGsHtEWfR' : 'goog_eYhrxPwwtRYXwhBwsnfCvxmxnRX'

const config = {
  appName: isNoman ? 'Blox Fruit Values Calc' : 'Blox Fruit Stock',
  andriodBanner: isNoman ? 'ca-app-pub-5740215782746766/7656147637' : 'ca-app-pub-3701208411582706/4133745803',
  andriodIntestial: isNoman ? 'ca-app-pub-5740215782746766/3840191550' : 'ca-app-pub-3701208411582706/2820664136',
  andriodRewarded: isNoman ? 'ca-app-pub-5740215782746766/6313459657' : 'ca-app-pub-3701208411582706/5175818984',
  andriodOpenApp: isNoman ? 'ca-app-pub-5740215782746766/8634187387' : 'ca-app-pub-3701208411582706/2295931822',
  andriodNative: isNoman ? 'ca-app-pub-5740215782746766/2941106105' : 'ca-app-pub-3701208411582706/5457520430',
  IOsIntestial: isNoman ? 'ca-app-pub-5740215782746766/5910517787' : '',
  IOsBanner: isNoman ? 'ca-app-pub-5740215782746766/9032339297' : '',
  IOsRewarded: isNoman ? 'ca-app-pub-5740215782746766/6913442412' : '',
  IOsOpenApp: isNoman ? 'ca-app-pub-5740215782746766/6747304345' : '',
  IOsNative: isNoman ? 'ca-app-pub-5740215782746766/8838394066' : '',

  apiKey: isNoman ? rev_cat_id : rev_cat_id,

  supportEmail: isNoman ? 'thesolanalabs@gmail.com' : 'mindfusionio.help@gmail.com',
  andriodShareLink: isNoman ? 'https://play.google.com/store/apps/details?id=com.adoptmevaluescalc' : 'https://play.google.com/store/apps/details?id=com.bloxfruitstock',
  IOsShareLink: isNoman ? 'https://apps.apple.com/us/app/app-name/id6745400111' : '',
  IOsShareLink: isNoman ? 'https://apps.apple.com/us/app/app-name/id6745400111' : '',
  webSite: isNoman ? 'https://adoptmevalues.app/' : 'https://bloxfruitvalue.today',

  isNoman: isNoman ? true : false,

  otherapplink: Platform.OS == 'android' ? 'https://play.google.com/store/apps/details?id=com.bloxfruitevalues' : 'https://apps.apple.com/us/app/app-name/id6737775801',
  otherapplink2: Platform.OS == 'android' ? 'https://play.google.com/store/apps/details?id=com.mm2tradesvalues' : 'https://apps.apple.com/us/app/app-name/id6737775801',
  colors: isNoman
    ? {
      primary: '#ff6666', // Muted grayish blue
      secondary: '#3E8BFC', // Bright action blue
      hasBlockGreen: 'rgb(255, 102, 102)', // Vibrant success green
      wantBlockRed: '#66b266', // Vivid warning red
      backgroundLight: '#f2f2f7',
      backgroundDark: '#121212',
      white:'white',
      black:'black'
    }
    : {
      primary: '#697565', // Deep navy blue
      secondary: '#457B9D', // Muted teal
      hasBlockGreen: '#B8860B', // Light mint green
      wantBlockRed: '#E63946', // Warm, soft red
      backgroundLight: '#f2f2f7',
      backgroundDark: '#121212',
       white:'white',
      black:'black'
    },

};

export default config;
