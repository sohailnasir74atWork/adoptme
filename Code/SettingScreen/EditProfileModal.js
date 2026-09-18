import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  FlatList,
  Image,
  Modal,
  Pressable,
  KeyboardAvoidingView,
  // `Platform` is referenced by the KeyboardAvoidingView behavior prop
  // below but was never imported — this component threw
  // "ReferenceError: Platform is not defined" as soon as it rendered.
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGlobalState } from '../GlobelStats';
import SwipeableBottomDrawer from '../Helper/SwipeableBottomDrawer';

export default function EditProfileModal({
  visible,
  onClose,
  newDisplayName,
  setNewDisplayName,
  selectedImage,
  setSelectedImage,
}) {
  const insets = useSafeAreaInsets();
  // const {localeState} = useGlobalState();
  // console.log(localeState.data, 'SDD')
  const imageOptions = [
    require('../Avtar/display-pic.png'),
    require('../Avtar/eagle.png'),
    require('../Avtar/patch.png'),
    require('../Avtar/pirate1.png'),
  ];

  const handleSave = () => {
    onClose();
    alert('Profile changes saved!');
  };

  return (
    <Modal
      animationType="slide"
      transparent={true}
      visible={visible}
      onRequestClose={onClose}
    >
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }}
        onPress={onClose}
      />
             <KeyboardAvoidingView
        style={{ flex: 1, justifyContent: 'flex-end' }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={60} // Adjust offset as needed
      >

      <SwipeableBottomDrawer onClose={onClose} style={{
          backgroundColor: '#fff',
          padding: 20,
          // Clears the system navigation bar (targetSdk 36 draws
          // edge-to-edge, so nothing is inset for us).
          paddingBottom: 20 + insets.bottom,
        }}>
        <Text style={{ fontSize: 18, fontWeight: '600', marginBottom: 15 }}>
          Edit Profile
        </Text>

        {/* Name Input */}
        <Text style={{ fontSize: 16, marginBottom: 10 }}>Change Display Name</Text>
        <TextInput
          style={{
            backgroundColor: '#f2f2f7',
            padding: 10,
            borderRadius: 5,
            marginBottom: 20,
          }}
          placeholder="Enter new display name"
          value={newDisplayName}
          onChangeText={setNewDisplayName}
        />

        {/* Profile Image Selection */}
        <Text style={{ fontSize: 16, marginBottom: 10 }}>Select Profile Icon</Text>
        <FlatList
          data={imageOptions}
          keyExtractor={(item, index) => index.toString()}
          horizontal
          renderItem={({ item }) => (
            <TouchableOpacity onPress={() => setSelectedImage(item)}>
              <Image
                source={item}
                style={{
                  width: 60,
                  height: 60,
                  borderRadius: 30,
                  marginHorizontal: 10,
                  borderWidth: item === selectedImage ? 2 : 0,
                  borderColor: '#007BFF',
                }}
              />
            </TouchableOpacity>
          )}
        />

        <TouchableOpacity
          style={{
            backgroundColor: '#007BFF',
            padding: 10,
            borderRadius: 5,
            marginTop: 20,
          }}
          onPress={handleSave}
        >
          <Text style={{ color: '#fff', textAlign: 'center' }}>Save Changes</Text>
        </TouchableOpacity>
      </SwipeableBottomDrawer>
      </KeyboardAvoidingView>

    </Modal>
  );
}
