import { useState, useEffect } from 'react';
import { getDatabase, ref, update, get, set, onDisconnect, query, orderByChild, equalTo, limitToLast, onValue } from '@react-native-firebase/database';
import { Alert } from 'react-native';

// Initialize the database reference
const database = getDatabase();
const usersRef = ref(database, 'users'); // Base reference to the "users" node

// Format Date Utility
export const formatDate = (dateString) => {
  const date = new Date(dateString);
  return isNaN(date)
    ? 'Invalid Date' // Handle invalid date cases gracefully
    : date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
};

// Ban User
export const banUser = async (userId) => {
  // ✅ Safety check
  if (!userId) {
    Alert.alert('Error', 'Invalid user ID.');
    return false;
  }

  try {
    const deleteResult = await handleDeleteLast300Messages(userId, false);
    const database = getDatabase();
    const userToUpdateRef = ref(database, `users/${userId}`);
    await update(userToUpdateRef, { isBlock: true });

    const msgCount = deleteResult?.count || 0;
    Alert.alert('Success', `User banned.${msgCount > 0 ? ` ${msgCount} messages deleted.` : ''}`);
    return true;
  } catch (error) {
    console.error('Error banning user:', error);
    Alert.alert('Error', 'Failed to ban the user.');
    return false;
  }
};

// Unban User
export const unbanUser = async (userId) => {
  // ✅ Safety check
  if (!userId) {
    Alert.alert('Error', 'Invalid user ID.');
    return false;
  }

  try {
    const database = getDatabase();
    const userToUpdateRef = ref(database, `users/${userId}`);
    await update(userToUpdateRef, { isBlock: false });
    Alert.alert('Success', 'User has been unbanned.');
    return true;
  } catch (error) {
    console.error('Error unbanning user:', error);
    Alert.alert('Error', 'Failed to unban the user.');
    return false;
  }
};

// Remove Admin
export const removeAdmin = async (userId) => {
  // ✅ Safety check
  if (!userId) {
    Alert.alert('Error', 'Invalid user ID.');
    return false;
  }

  try {
    const db = getDatabase();
    const userToUpdateRef = ref(db, `users/${userId}`);
    await update(userToUpdateRef, { admin: false });
    Alert.alert('Success', 'Admin privileges removed.');
    return true;
  } catch (error) {
    console.error('Error removing admin:', error);
    Alert.alert('Error', 'Failed to remove admin privileges.');
    return false;
  }
};

// Make Admin
export const makeAdmin = async (userId) => {
  // ✅ Safety check
  if (!userId) {
    Alert.alert('Error', 'Invalid user ID.');
    return false;
  }

  try {
    const db = getDatabase();
    const userToUpdateRef = ref(db, `users/${userId}`);
    await update(userToUpdateRef, { admin: true });
    Alert.alert('Success', 'User is now an admin.');
    return true;
  } catch (error) {
    console.error('Error making admin:', error);
    Alert.alert('Error', 'Failed to make user an admin.');
    return false;
  }
};

// Make Owner
export const makeOwner = async (userId) => {
  // ✅ Safety check
  if (!userId) {
    Alert.alert('Error', 'Invalid user ID.');
    return false;
  }

  try {
    const db = getDatabase();
    const userToUpdateRef = ref(db, `users/${userId}`);
    await update(userToUpdateRef, { owner: true });
    Alert.alert('Success', 'User is now an owner.');
    return true;
  } catch (error) {
    console.error('Error making owner:', error);
    Alert.alert('Error', 'Failed to make user an owner.');
    return false;
  }
};
export const rulesen = [
  "Always communicate respectfully. Hate speech, discrimination, and harassment are strictly prohibited.",
  "Avoid sharing offensive, explicit, or inappropriate content, including text, images, or links.",
  "Do not share personal, sensitive, or confidential information such as phone numbers, addresses, or financial details.",
  "Spamming, repetitive messaging, or promoting products/services without permission is not allowed.",
  "If you encounter inappropriate behavior, use the report or block tools available in the app.",
  "Use appropriate language in the chat. Avoid abusive or overly aggressive tones.",
  "Discussions or activities promoting illegal or unethical behavior are prohibited.",
  "Users are responsible for the content they share and must adhere to community guidelines.",
  "Moderators reserve the right to monitor and take action on any violations, including warnings or bans.",
  "Content should be suitable for all approved age groups, adhering to app age requirements.",
  "Do not share links to harmful sites, malware, or malicious content.",
  "By using the chat feature, you agree to the app’s Terms of Service and Privacy Policy.https://bloxfruitscalc.com/privacy-policy/",
];

export const rulesde = [
  "Kommunizieren Sie immer respektvoll. Hassreden, Diskriminierung und Belästigung sind streng verboten.",
  "Vermeiden Sie das Teilen von anstößigen, expliziten oder unangemessenen Inhalten, einschließlich Text, Bildern oder Links.",
  "Geben Sie keine persönlichen, sensiblen oder vertraulichen Informationen wie Telefonnummern, Adressen oder Finanzdaten weiter.",
  "Spam, wiederholte Nachrichten oder das Bewerben von Produkten/Dienstleistungen ohne Erlaubnis sind nicht erlaubt.",
  "Wenn Sie unangemessenes Verhalten bemerken, nutzen Sie die Melde- oder Blockierfunktion der App.",
  "Verwenden Sie eine angemessene Sprache im Chat. Vermeiden Sie beleidigende oder aggressive Töne.",
  "Diskussionen oder Aktivitäten, die illegales oder unethisches Verhalten fördern, sind verboten.",
  "Benutzer sind für die Inhalte verantwortlich, die sie teilen, und müssen sich an die Community-Richtlinien halten.",
  "Moderatoren behalten sich das Recht vor, Verstöße zu überwachen und Maßnahmen zu ergreifen, einschließlich Verwarnungen oder Sperren.",
  "Inhalte sollten für alle genehmigten Altersgruppen geeignet sein und den Altersanforderungen der App entsprechen.",
  "Teilen Sie keine Links zu schädlichen Websites, Malware oder bösartigen Inhalten.",
  "Durch die Nutzung der Chat-Funktion stimmen Sie den Nutzungsbedingungen und der Datenschutzrichtlinie der App zu. https://bloxfruitscalc.com/privacy-policy/"
]


export const rulesvi = [
  "Luôn giao tiếp một cách tôn trọng. Phát ngôn thù địch, phân biệt đối xử và quấy rối đều bị nghiêm cấm.",
  "Tránh chia sẻ nội dung phản cảm, rõ ràng hoặc không phù hợp, bao gồm văn bản, hình ảnh hoặc liên kết.",
  "Không chia sẻ thông tin cá nhân, nhạy cảm hoặc bảo mật như số điện thoại, địa chỉ hoặc dữ liệu tài chính.",
  "Không spam, gửi tin nhắn lặp lại hoặc quảng bá sản phẩm/dịch vụ mà không được phép.",
  "Nếu bạn gặp hành vi không phù hợp, hãy sử dụng công cụ báo cáo hoặc chặn có trong ứng dụng.",
  "Sử dụng ngôn ngữ phù hợp trong cuộc trò chuyện. Tránh giọng điệu lăng mạ hoặc hung hăng.",
  "Các cuộc thảo luận hoặc hoạt động thúc đẩy hành vi bất hợp pháp hoặc phi đạo đức bị cấm.",
  "Người dùng chịu trách nhiệm về nội dung họ chia sẻ và phải tuân thủ nguyên tắc cộng đồng.",
  "Người điều hành có quyền giám sát và thực hiện hành động đối với bất kỳ vi phạm nào, bao gồm cảnh báo hoặc cấm.",
  "Nội dung phải phù hợp với tất cả các nhóm tuổi được phê duyệt, tuân theo yêu cầu về độ tuổi của ứng dụng.",
  "Không chia sẻ liên kết đến các trang web độc hại, phần mềm độc hại hoặc nội dung độc hại.",
  "Bằng cách sử dụng tính năng trò chuyện, bạn đồng ý với Điều khoản dịch vụ và Chính sách quyền riêng tư của ứng dụng. https://bloxfruitscalc.com/privacy-policy/"
]

export const rulesid = [
  "Selalu berkomunikasi dengan hormat. Ujaran kebencian, diskriminasi, dan pelecehan dilarang keras.",
  "Hindari berbagi konten yang menyinggung, eksplisit, atau tidak pantas, termasuk teks, gambar, atau tautan.",
  "Jangan bagikan informasi pribadi, sensitif, atau rahasia seperti nomor telepon, alamat, atau data keuangan.",
  "Spam, pengiriman pesan berulang, atau promosi produk/jasa tanpa izin tidak diperbolehkan.",
  "Jika Anda menemukan perilaku yang tidak pantas, gunakan alat laporan atau pemblokiran yang tersedia di aplikasi.",
  "Gunakan bahasa yang sesuai dalam obrolan. Hindari nada kasar atau agresif.",
  "Diskusi atau aktivitas yang mendorong perilaku ilegal atau tidak etis dilarang.",
  "Pengguna bertanggung jawab atas konten yang mereka bagikan dan harus mematuhi pedoman komunitas.",
  "Moderator berhak untuk memantau dan mengambil tindakan terhadap pelanggaran, termasuk peringatan atau larangan.",
  "Konten harus sesuai untuk semua kelompok umur yang disetujui, sesuai dengan persyaratan usia aplikasi.",
  "Jangan bagikan tautan ke situs berbahaya, malware, atau konten berbahaya.",
  "Dengan menggunakan fitur obrolan, Anda menyetujui Ketentuan Layanan dan Kebijakan Privasi aplikasi. https://bloxfruitscalc.com/privacy-policy/"
]

export const rulesfr = [
  "Communiquez toujours avec respect. Les discours de haine, la discrimination et le harcèlement sont strictement interdits.",
  "Évitez de partager du contenu offensant, explicite ou inapproprié, y compris du texte, des images ou des liens.",
  "Ne partagez pas d’informations personnelles, sensibles ou confidentielles telles que des numéros de téléphone, des adresses ou des données financières.",
  "Le spam, l’envoi répété de messages ou la promotion de produits/services sans autorisation ne sont pas autorisés.",
  "Si vous observez un comportement inapproprié, utilisez les outils de signalement ou de blocage disponibles dans l’application.",
  "Utilisez un langage approprié dans le chat. Évitez les tons insultants ou agressifs.",
  "Les discussions ou activités encourageant des comportements illégaux ou contraires à l’éthique sont interdites.",
  "Les utilisateurs sont responsables du contenu qu’ils partagent et doivent respecter les règles de la communauté.",
  "Les modérateurs se réservent le droit de surveiller et de prendre des mesures contre toute violation, y compris des avertissements ou des interdictions.",
  "Le contenu doit être adapté à tous les groupes d’âge approuvés, conformément aux exigences d’âge de l’application.",
  "Ne partagez pas de liens vers des sites nuisibles, des logiciels malveillants ou du contenu malveillant.",
  "En utilisant la fonction de chat, vous acceptez les Conditions d’utilisation et la Politique de confidentialité de l’application. https://bloxfruitscalc.com/privacy-policy/"
]

export const rulesfil = [
  "Laging makipag-usap nang may paggalang. Ang mapoot na pananalita, diskriminasyon, at pananakot ay mahigpit na ipinagbabawal.",
  "Iwasan ang pagbabahagi ng nakakasakit, malaswa, o hindi angkop na nilalaman, kabilang ang teksto, larawan, o mga link.",
  "Huwag ibahagi ang personal, sensitibo, o kumpidensyal na impormasyon tulad ng mga numero ng telepono, address, o data sa pananalapi.",
  "Ang spam, paulit-ulit na pagpapadala ng mensahe, o promosyon ng produkto/serbisyo nang walang pahintulot ay hindi pinapayagan.",
  "Kung makakita ka ng hindi naaangkop na pag-uugali, gamitin ang tool sa pag-uulat o pag-block sa app.",
  "Gumamit ng angkop na wika sa chat. Iwasan ang bastos o agresibong tono.",
  "Ipinagbabawal ang mga talakayan o aktibidad na nagtataguyod ng ilegal o hindi etikal na pag-uugali.",
  "Ang mga gumagamit ay may pananagutan sa nilalaman na kanilang ibinabahagi at dapat sumunod sa mga patakaran ng komunidad.",
  "Ang mga moderator ay may karapatang subaybayan at gumawa ng aksyon laban sa anumang paglabag, kabilang ang mga babala o pagbabawal.",
  "Ang nilalaman ay dapat na angkop para sa lahat ng pinapayagang pangkat ng edad, alinsunod sa mga kinakailangan sa edad ng app.",
  "Huwag magbahagi ng mga link sa nakakapinsalang mga site, malware, o mapanirang nilalaman.",
  "Sa paggamit ng tampok na chat, sumasang-ayon ka sa Mga Tuntunin ng Serbisyo at Patakaran sa Privacy ng app. https://bloxfruitscalc.com/privacy-policy/"
]

export const rulesru = [
  "Всегда общайтесь уважительно. Речи ненависти, дискриминация и преследование строго запрещены.",
  "Избегайте распространения оскорбительного, непристойного или неуместного контента, включая текст, изображения или ссылки.",
  "Не делитесь личной, конфиденциальной или чувствительной информацией, такой как номера телефонов, адреса или финансовые данные.",
  "Спам, повторяющиеся сообщения или реклама товаров/услуг без разрешения запрещены.",
  "Если вы заметили неподобающее поведение, используйте инструменты жалоб или блокировки в приложении.",
  "Используйте соответствующий язык в чате. Избегайте оскорбительного или агрессивного тона.",
  "Запрещены обсуждения или действия, продвигающие незаконное или неэтичное поведение.",
  "Пользователи несут ответственность за публикуемый контент и должны соблюдать правила сообщества.",
  "Модераторы имеют право контролировать и применять меры против нарушений, включая предупреждения или блокировки.",
  "Контент должен быть подходящим для всех одобренных возрастных групп, соответствуя требованиям приложения по возрасту.",
  "Не делитесь ссылками на вредоносные сайты, вредоносное ПО или вредоносный контент.",
  "Используя чат, вы соглашаетесь с Условиями использования и Политикой конфиденциальности приложения. https://bloxfruitscalc.com/privacy-policy/"
]
export const rulespt = [
  "Comunique-se sempre com respeito. Discursos de ódio, discriminação e assédio são estritamente proibidos.",
  "Evite compartilhar conteúdo ofensivo, explícito ou inapropriado, incluindo texto, imagens ou links.",
  "Não compartilhe informações pessoais, sensíveis ou confidenciais, como números de telefone, endereços ou dados financeiros.",
  "Spam, envio repetitivo de mensagens ou promoção de produtos/serviços sem permissão não são permitidos.",
  "Se encontrar um comportamento inadequado, utilize as ferramentas de denúncia ou bloqueio disponíveis no aplicativo.",
  "Use uma linguagem apropriada no chat. Evite tons ofensivos ou agressivos.",
  "Discussões ou atividades que promovam comportamentos ilegais ou antiéticos são proibidas.",
  "Os usuários são responsáveis pelo conteúdo que compartilham e devem seguir as diretrizes da comunidade.",
  "Os moderadores têm o direito de monitorar e tomar medidas contra qualquer violação, incluindo advertências ou banimentos.",
  "O conteúdo deve ser adequado para todas as faixas etárias aprovadas, de acordo com os requisitos de idade do aplicativo.",
  "Não compartilhe links para sites prejudiciais, malware ou conteúdos maliciosos.",
  "Ao usar o recurso de chat, você concorda com os Termos de Serviço e a Política de Privacidade do aplicativo. https://bloxfruitscalc.com/privacy-policy/"
]

// export const banUserInChat = async (currentUserId, selectedUser) => {
//   return new Promise((resolve, reject) => {
//     Alert.alert(
//       'Block User',
//       `Are you sure you want to block ${selectedUser.sender || 'this user'}? You will no longer receive messages from them.`,
//       [
//         { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) }, // User cancels the operation
//         {
//           text: 'Block',
//           style: 'destructive',
//           onPress: async () => {
//             try {
//               const database = getDatabase();
//               const bannedRef = ref(database, `bannedUsers/${currentUserId}/${selectedUser.senderId}`);

//               // Save the banned user's details in the database
//               await set(bannedRef, {
//                 displayName: selectedUser.sender || 'Anonymous',
//                 avatar: selectedUser.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
//               });

//               Alert.alert(
//                 'Success',
//                 `You have successfully blocked ${selectedUser.sender || 'this user'}.`
//               );
//               resolve(true); // Indicate success
//             } catch (error) {
//               console.error('Error blocking user:', error);
//               Alert.alert('Error', 'Could not block the user. Please try again.');
//               reject(error); // Indicate failure with the error
//             }
//           },
//         },
//       ]
//     );
//   });
// };

// export const unbanUserInChat = async (currentUserId, selectedUserId) => {
//   return new Promise((resolve, reject) => {
//     Alert.alert(
//       'Unblock User',
//       'Are you sure you want to unblock this user? You will start receiving messages from them again.',
//       [
//         { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) }, // User cancels the operation
//         {
//           text: 'Unblock',
//           style: 'destructive',
//           onPress: async () => {
//             try {
//               const database = getDatabase();
//               const bannedRef = ref(database, `bannedUsers/${currentUserId}/${selectedUserId}`);

//               // Remove the banned user's data from the database
//               await remove(bannedRef);

//               Alert.alert('Success', 'You have successfully unblocked this user.');
//               resolve(true); // Indicate success
//             } catch (error) {
//               console.error('Error unblocking user:', error);
//               Alert.alert('Error', 'Could not unblock the user. Please try again.');
//               reject(error); // Indicate failure with the error
//             }
//           },
//         },
//       ]
//     );
//   });
// };







export const isUserOnline = async (userId) => {
  if (!userId) return false; // ✅ Return early if userId is invalid

  try {
    // ✅ Read from presence node instead of users/{uid}/online
    const presenceRef = ref(getDatabase(), `presence/${userId}`);
    const snapshot = await get(presenceRef);

    return snapshot.val() ?? false; // ✅ Return online status OR false (cleaner)
  } catch (error) {
    console.error("🔥 Error checking user online status:", error);
    return false; // ✅ Always return a boolean
  }
};

/**
 * Real-time online status hook — uses onValue listener on presence/{userId}.
 * Unlike isUserOnline() which is a one-shot get(), this updates live
 * when the user goes online/offline. Use in components that stay on screen
 * (BottomDrawer, PrivateChatHeader, PrivateChat).
 */
export const useOnlineStatus = (userId) => {
  const [isOnline, setIsOnline] = useState(false);

  useEffect(() => {
    if (!userId) {
      setIsOnline(false);
      return;
    }

    const presenceRef = ref(getDatabase(), `presence/${userId}`);
    const unsubscribe = onValue(presenceRef, (snapshot) => {
      setIsOnline(snapshot.val() === true);
    }, (error) => {
      console.error('useOnlineStatus listener error:', error);
      setIsOnline(false);
    });

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [userId]);

  return isOnline;
};

export const setActiveChat = async (userId, chatId) => {
  // ✅ Safety checks
  if (!userId || !chatId) {
    console.error('❌ Invalid userId or chatId for setActiveChat');
    return;
  }

  try {
    const database = getDatabase();
    const activeChatRef = ref(database, `/activeChats/${userId}`);
    const unreadRef = ref(database, `/private_messages/${chatId}/unread/${userId}`);

    await set(activeChatRef, chatId);
    await set(unreadRef, 0);
    await onDisconnect(activeChatRef).remove();
  } catch (error) {
    console.error(`❌ Failed to set active chat for user ${userId}:`, error);
  }
};





export const clearActiveChat = async (userId) => {
  // ✅ Safety check
  if (!userId) {
    console.error('❌ Invalid userId for clearActiveChat');
    return;
  }

  try {
    const database = getDatabase();
    const activeChatRef = ref(database, `/activeChats/${userId}`);

    await set(activeChatRef, null);
  } catch (error) {
    console.error(`❌ Failed to clear active chat for user ${userId}:`, error);
  }
};

// ========== Group Chat Helper Functions ==========

/**
 * Set active group chat (for efficient batch checking)
 * @param {String} userId - User ID
 * @param {String} groupId - Group ID
 */
export const setActiveGroupChat = async (userId, groupId) => {
  if (!userId || !groupId) {
    console.error('❌ Invalid userId or groupId for setActiveGroupChat');
    return;
  }

  try {
    const database = getDatabase();
    const activeGroupRef = ref(database, `activeGroupChats/${groupId}/${userId}`);
    await set(activeGroupRef, true);
    await onDisconnect(activeGroupRef).remove(); // Auto-clear on disconnect
  } catch (error) {
    console.error('❌ Failed to set active group chat:', error);
  }
};

/**
 * Clear active group chat
 * @param {String} userId - User ID
 * @param {String} groupId - Group ID
 */
export const clearActiveGroupChat = async (userId, groupId) => {
  if (!userId || !groupId) {
    console.error('❌ Invalid userId or groupId for clearActiveGroupChat');
    return;
  }

  try {
    const database = getDatabase();
    const activeGroupRef = ref(database, `activeGroupChats/${groupId}/${userId}`);
    await set(activeGroupRef, null);
  } catch (error) {
    console.error('❌ Failed to clear active group chat:', error);
  }
};

/**
 * Check if user is in active group (for notifications)
 * @param {String} groupId - Group ID
 * @param {String} userId - User ID
 * @returns {Promise<boolean>}
 */
export const isUserInActiveGroup = async (groupId, userId) => {
  if (!groupId || !userId) return false;

  try {
    const database = getDatabase();
    const activeGroupRef = ref(database, `activeGroupChats/${groupId}/${userId}`);
    const snapshot = await get(activeGroupRef);
    return snapshot.exists() && snapshot.val() === true;
  } catch (error) {
    console.error('❌ Error checking active group:', error);
    return false;
  }
};

export const handleDeleteLast300Messages = async (senderId, showAlert = false, chatPath = 'chat_new') => {
  // ✅ Safety check
  if (!senderId) {
    console.error('❌ Invalid senderId for handleDeleteLast300Messages');
    return { success: false, count: 0 };
  }

  try {
    const db = getDatabase();
    const chatQuery = query(
      ref(db, chatPath),
      orderByChild('senderId'),
      equalTo(senderId),
      limitToLast(80)
    );

    const snapshot = await get(chatQuery);

    if (!snapshot.exists()) {
      if (showAlert) {
        Alert.alert('Info', 'No messages found to delete.');
      }
      return { success: true, count: 0 };
    }

    const allMessages = snapshot.val();
    if (!allMessages || typeof allMessages !== 'object') {
      return { success: true, count: 0 };
    }

    const sorted = Object.entries(allMessages)
      .sort((a, b) => {
        const timestampA = a[1]?.timestamp || 0;
        const timestampB = b[1]?.timestamp || 0;
        return timestampB - timestampA;
      })
      .slice(0, 60);

    const updates = {};
    sorted.forEach(([key]) => {
      if (key) {
        updates[`${chatPath}/${key}`] = null;
      }
    });

    const deletedCount = Object.keys(updates).length;
    if (deletedCount > 0) {
      await update(ref(db), updates);
      if (showAlert) {
        Alert.alert('Success', `${deletedCount} messages deleted.`);
      }
    }

    return { success: true, count: deletedCount };
  } catch (error) {
    console.error('🔥 Failed to delete messages:', error);
    if (showAlert) {
      Alert.alert('Error', 'Failed to delete messages.');
    }
    return { success: false, count: 0 };
  }
};


const encodeEmailForBan = (em) => (em || '').toLowerCase().trim().replace(/\./g, '(dot)');

export const banUserwithEmail = async (email, isAdmin = false, senderId = null, userInfo = null, bannerInfo = null) => {
  // ✅ Safety check
  if (!email || typeof email !== 'string' || email.trim().length === 0) {
    console.error('❌ Invalid email for banUserwithEmail');
    if (isAdmin) Alert.alert('Error', 'Invalid email address.');
    return false;
  }

  try {
    const db = getDatabase();
    const banRef = ref(db, `banned_users_by_email/${encodeEmailForBan(email)}`);
    const snap = await get(banRef);

    let strikeCount = 1;
    let bannedUntil = Date.now() + 12 * 60 * 60 * 1000; // 12 hours
    let banDuration = '12 hours';

    if (snap.exists()) {
      const data = snap.val();
      if (data && typeof data === 'object') {
        strikeCount = isAdmin ? (data.strikeCount || 0) + 1 : (data.strikeCount || 1);

        if (strikeCount === 2) {
          bannedUntil = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
          banDuration = '24 hours';
        } else if (strikeCount >= 3) {
          bannedUntil = "permanent";
          banDuration = 'permanent';
        }
      }
    }

    // ✅ Enhanced: Save displayName and user info
    const banData = {
      strikeCount,
      bannedUntil,
      reason: `Strike ${strikeCount}`,
      bannedAt: Date.now(),
      userId: senderId || userInfo?.id || null,
      displayName: userInfo?.displayName || 'Unknown User',
      avatar: userInfo?.avatar || null,
      email: email,
      bannedBy: bannerInfo?.displayName || 'Admin',
      bannerAvatar: bannerInfo?.avatar || null,
    };

    await set(banRef, banData);

    // ❌ DISABLED: Delete messages if senderId provided (too heavy operation)
    // let deletedCount = 0;
    // if (senderId) {
    //   const deleteResult = await handleDeleteLast300Messages(senderId, false);
    //   deletedCount = deleteResult?.count || 0;
    // }

    // ✅ Always show alert to admin who performed the action
    if (isAdmin) {
      Alert.alert(
        'User Banned',
        `Strike ${strikeCount} applied (${banDuration}).`
      );
    }

    return true;
  } catch (err) {
    console.error('Ban error:', err);
    if (isAdmin) Alert.alert('Error', 'Could not ban user.');
    return false;
  }
};

// ✅ NEW: Set specific strike count (for Admin Dashboard)
export const setUserStrike = async (email, strikeCount, senderId = null, showAlert = true, bannerInfo = null, userInfo = null) => {
  // Safety check
  if (!email || typeof email !== 'string' || email.trim().length === 0) {
    console.error('❌ Invalid email for setUserStrike');
    if (showAlert) Alert.alert('Error', 'Invalid email address.');
    return false;
  }

  if (!strikeCount || strikeCount < 1) {
    console.error('❌ Invalid strike count');
    if (showAlert) Alert.alert('Error', 'Invalid strike count.');
    return false;
  }

  try {
    const db = getDatabase();
    const banRef = ref(db, `banned_users_by_email/${encodeEmailForBan(email)}`);

    // Determine ban duration based on strike count
    let bannedUntil;
    let banDuration;

    if (strikeCount === 1) {
      bannedUntil = Date.now() + 12 * 60 * 60 * 1000; // 12 hours
      banDuration = '12 hours';
    } else if (strikeCount === 2) {
      bannedUntil = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
      banDuration = '24 hours';
    } else {
      // Strike 3+ = permanent ban
      bannedUntil = "permanent";
      banDuration = 'permanent';
    }

    // ✅ Enhanced: Save displayName and user info
    const strikeData = {
      strikeCount,
      bannedUntil,
      reason: `Strike ${strikeCount}`,
      appliedAt: Date.now(),
      userId: senderId || userInfo?.id || null,
      displayName: userInfo?.displayName || 'Unknown User',
      avatar: userInfo?.avatar || null,
      email: email,
      bannedBy: bannerInfo?.displayName || 'Admin',
      bannerAvatar: bannerInfo?.avatar || null,
    };

    await set(banRef, strikeData);

    // ❌ DISABLED: Delete messages if senderId provided (too heavy operation)
    // let deletedCount = 0;
    // if (senderId) {
    //   const deleteResult = await handleDeleteLast300Messages(senderId, false);
    //   deletedCount = deleteResult?.count || 0;
    // }

    if (showAlert) {
      Alert.alert(
        'Strike Applied',
        `Strike ${strikeCount} applied (${banDuration}).`
      );
    }

    return true;
  } catch (err) {
    console.error('Set strike error:', err);
    if (showAlert) Alert.alert('Error', 'Could not apply strike.');
    return false;
  }
};

/**
 * Mute a user for a specified number of minutes.
 * Uses the SAME DB structure as bans (banned_users_by_email) — just a short bannedUntil.
 * Does NOT increment strikeCount — mutes are temporary silences, not strikes.
 * Existing useBanStatus/checkBanStatus already handle time-based expiry.
 */
export const muteUser = async (email, minutes, userInfo = null, bannerInfo = null, showAlert = true) => {
  if (!email || typeof email !== 'string' || email.trim().length === 0) {
    console.error('❌ Invalid email for muteUser');
    if (showAlert) Alert.alert('Error', 'Invalid email address.');
    return false;
  }

  if (!minutes || minutes < 1) {
    if (showAlert) Alert.alert('Error', 'Mute duration must be at least 1 minute.');
    return false;
  }

  try {
    const db = getDatabase();
    const banRef = ref(db, `banned_users_by_email/${encodeEmailForBan(email)}`);
    const snap = await get(banRef);

    // Preserve existing strikeCount if user was previously banned
    const existingStrikeCount = snap.exists() ? (snap.val()?.strikeCount || 0) : 0;

    const muteData = {
      strikeCount: existingStrikeCount,
      bannedUntil: Date.now() + minutes * 60 * 1000,
      reason: `Muted for ${minutes} min`,
      bannedAt: Date.now(),
      userId: userInfo?.id || null,
      displayName: userInfo?.displayName || 'Unknown User',
      avatar: userInfo?.avatar || null,
      email: email,
      bannedBy: bannerInfo?.displayName || 'Admin',
      bannerAvatar: bannerInfo?.avatar || null,
    };

    await set(banRef, muteData);

    if (showAlert) {
      Alert.alert('User Muted', `Muted for ${minutes} minute${minutes !== 1 ? 's' : ''}.`);
    }

    return true;
  } catch (err) {
    console.error('Mute error:', err);
    if (showAlert) Alert.alert('Error', 'Could not mute user.');
    return false;
  }
};

export const unbanUserWithEmail = async (email, showAlert = true) => {
  // ✅ Safety check
  if (!email || typeof email !== 'string' || email.trim().length === 0) {
    console.error('❌ Invalid email for unbanUserWithEmail');
    if (showAlert) Alert.alert('Error', 'Invalid email address.');
    return false;
  }

  try {
    const db = getDatabase();
    // Remove both lowercase and original-casing keys (handles legacy + new data)
    const keyLower = encodeEmailForBan(email);
    const keyOriginal = email.replace(/\./g, '(dot)');
    await set(ref(db, `banned_users_by_email/${keyLower}`), null);
    if (keyOriginal !== keyLower) {
      await set(ref(db, `banned_users_by_email/${keyOriginal}`), null);
    }

    if (showAlert) Alert.alert('User Unbanned', 'Ban has been lifted.');
    return true;
  } catch (err) {
    console.error('Unban error:', err);
    if (showAlert) Alert.alert('Error', 'Could not unban user.');
    return false;
  }
};

/**
 * Hook to check if a user is banned based on their email.
 * Listens to `banned_users_by_email` in real-time.
 * Uses lowercase email to avoid auth/DB casing mismatch.
 */
export const useBanStatus = (email) => {
  const [isBanned, setIsBanned] = useState(false);
  const [banDetails, setBanDetails] = useState(null);

  useEffect(() => {
    if (!email) {
      setIsBanned(false);
      setBanDetails(null);
      return;
    }

    const db = getDatabase();
    const banRef = ref(db, `banned_users_by_email/${encodeEmailForBan(email)}`);

    const unsubscribe = onValue(banRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        const now = Date.now();

        let active = false;
        if (data.bannedUntil === 'permanent') {
          active = true;
        } else if (typeof data.bannedUntil === 'number' && data.bannedUntil > now) {
          active = true;
        }

        setIsBanned(active);
        setBanDetails(active ? data : null);
      } else {
        setIsBanned(false);
        setBanDetails(null);
      }
    });

    return () => unsubscribe();
  }, [email]);

  return { isBanned, banDetails };
};

/**
 * Check if a user is banned globally.
 * @param {string} email - User email
 * @returns {Promise<{isBanned: boolean, message: string|null}>}
 */
export const checkBanStatus = async (email) => {
  if (!email || typeof email !== 'string') return { isBanned: false, message: null };

  const db = getDatabase();
  const banRef = ref(db, `banned_users_by_email/${encodeEmailForBan(email)}`);

  try {
    const snap = await get(banRef);
    if (!snap.exists()) return { isBanned: false, message: null };

    const data = snap.val();
    const { bannedUntil, reason, strikeCount } = data;

    if (bannedUntil === 'permanent') {
      return {
        isBanned: true,
        message: `You are permanently banned (Strike ${strikeCount}).`
      };
    }

    const now = Date.now();
    if (bannedUntil > now) {
      const diff = bannedUntil - now;
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

      let timeString = '';
      if (days > 0) timeString += `${days} days `;
      if (hours > 0) timeString += `${hours} hours `;
      if (minutes > 0) timeString += `${minutes} minutes`;

      return {
        isBanned: true,
        message: `You are banned for ${timeString.trim()} (Strike ${strikeCount}).`
      };
    }

    return { isBanned: false, message: null };

  } catch (error) {
    console.error('Error checking ban status:', error);
    return { isBanned: false, message: null }; // Fail safe
  }
};

// Make Moderator
export const makeModerator = async (userId) => {
  if (!userId) {
    Alert.alert('Error', 'Invalid user ID.');
    return false;
  }
  try {
    const db = getDatabase();
    const userRef = ref(db, `users/${userId}`);
    await update(userRef, { isModerator: true });
    Alert.alert('Success', 'User is now a moderator.');
    return true;
  } catch (error) {
    console.error('Error making moderator:', error);
    Alert.alert('Error', 'Failed to promote user.');
    return false;
  }
};

// Remove Moderator
export const removeModerator = async (userId) => {
  if (!userId) {
    Alert.alert('Error', 'Invalid user ID.');
    return false;
  }
  try {
    const db = getDatabase();
    const userRef = ref(db, `users/${userId}`);
    await update(userRef, { isModerator: false });
    Alert.alert('Success', 'Moderator privileges removed.');
    return true;
  } catch (error) {
    console.error('Error removing moderator:', error);
    Alert.alert('Error', 'Failed to demote user.');
    return false;
  }
};
