import React, { useRef, useImperativeHandle, forwardRef, useState } from 'react';
import { View, Animated, Easing, StyleSheet, Dimensions } from 'react-native';

const { width: SW, height: SH } = Dimensions.get('window');
const COLORS = ['#FFD93D', '#06B6D4', '#F472B6', '#34D399', '#A78BFA', '#FB923C', '#60A5FA', '#F87171'];
const COUNT = 60;

const Confetti = forwardRef((_, ref) => {
    const [running, setRunning] = useState(false);
    const anims = useRef(
        Array.from({ length: COUNT }, () => ({
            y: new Animated.Value(-20),
            x: new Animated.Value(0),
            rotate: new Animated.Value(0),
            opacity: new Animated.Value(1),
        }))
    ).current;

    const configs = useRef(
        Array.from({ length: COUNT }, () => ({
            startX: Math.random() * SW,
            driftX: (Math.random() - 0.5) * 120,
            color: COLORS[Math.floor(Math.random() * COLORS.length)],
            size: 6 + Math.random() * 6,
            duration: 1800 + Math.random() * 1200,
            delay: Math.random() * 400,
        }))
    ).current;

    useImperativeHandle(ref, () => ({
        start: () => {
            setRunning(true);
            const animations = anims.map((a, i) => {
                const c = configs[i];
                a.y.setValue(-20);
                a.x.setValue(0);
                a.rotate.setValue(0);
                a.opacity.setValue(1);
                return Animated.sequence([
                    Animated.delay(c.delay),
                    Animated.parallel([
                        Animated.timing(a.y, {
                            toValue: SH + 40,
                            duration: c.duration,
                            easing: Easing.in(Easing.quad),
                            useNativeDriver: true,
                        }),
                        Animated.timing(a.x, {
                            toValue: c.driftX,
                            duration: c.duration,
                            easing: Easing.out(Easing.sin),
                            useNativeDriver: true,
                        }),
                        Animated.timing(a.rotate, {
                            toValue: 4 + Math.random() * 6,
                            duration: c.duration,
                            useNativeDriver: true,
                        }),
                        Animated.sequence([
                            Animated.delay(c.duration * 0.6),
                            Animated.timing(a.opacity, {
                                toValue: 0,
                                duration: c.duration * 0.4,
                                useNativeDriver: true,
                            }),
                        ]),
                    ]),
                ]);
            });
            Animated.parallel(animations).start(() => setRunning(false));
        },
    }));

    if (!running) return null;

    return (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
            {anims.map((a, i) => {
                const c = configs[i];
                const isSquare = i % 3 !== 0;
                return (
                    <Animated.View
                        key={i}
                        style={{
                            position: 'absolute',
                            left: c.startX,
                            top: 0,
                            width: c.size,
                            height: isSquare ? c.size : c.size * 0.5,
                            backgroundColor: c.color,
                            borderRadius: isSquare ? 2 : c.size,
                            opacity: a.opacity,
                            transform: [
                                { translateY: a.y },
                                { translateX: a.x },
                                { rotate: a.rotate.interpolate({ inputRange: [0, 10], outputRange: ['0deg', '3600deg'] }) },
                            ],
                        }}
                    />
                );
            })}
        </View>
    );
});

export default Confetti;
