import { useCallback, useEffect, useRef, useState } from "react"; // Layoutn is just an example and should be replaced by real animation. For Instance Layout

import {
  ActivityIndicator,
  Alert,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { ContextMenuButton } from "react-native-ios-context-menu";
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  FadeOutDown,
  Layout,
} from "react-native-reanimated";
import * as FileSystem from "expo-file-system";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import * as ImageManipulator from "expo-image-manipulator";
import {
  Link,
  Stack,
  useFocusEffect,
  useNavigation,
  useRouter,
} from "expo-router";
import { StatusBar } from "expo-status-bar";
import {
  AppBskyEmbedImages,
  RichText as RichTextHelper,
  type BskyAgent,
} from "@atproto/api";
import { useTheme } from "@react-navigation/native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Paperclip, Plus, Send, X } from "lucide-react-native";

import { Avatar } from "../../components/avatar";
import { RichText } from "../../components/rich-text";
import { useAuthedAgent } from "../../lib/agent";
import { useImages } from "../../lib/hooks/composer";
import { locale } from "../../lib/locale";
import { cx } from "../../lib/utils/cx";

// text
const MAX_LENGTH = 300;

// images
const MAX_IMAGES = 4;
const MAX_SIZE = 1_000_000;
const MAX_DIMENSION = 2048;

const generateRichText = async (text: string, agent: BskyAgent) => {
  const rt = new RichTextHelper({ text });
  await rt.detectFacets(agent);
  return rt;
};

export default function ComposerScreen() {
  const theme = useTheme();
  const agent = useAuthedAgent();
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const router = useRouter();

  const [text, setText] = useState("");
  const { images, imagePicker, addAltText, removeImage } = useImages();

  const textRef = useRef<TextInput>(null);

  useFocusEffect(
    useCallback(() => {
      setTimeout(() => {
        textRef.current?.focus();
      }, 100);
    }, []),
  );

  const rt = useQuery({
    queryKey: ["rt", text],
    queryFn: async () => {
      return await generateRichText(text, agent);
    },
    keepPreviousData: true,
  });

  const tooLong = (rt.data?.graphemeLength ?? 0) > MAX_LENGTH;

  const isEmpty = text.trim().length === 0 && images.length === 0;

  const send = useMutation({
    mutationKey: ["send"],
    mutationFn: async () => {
      if (!agent.hasSession) throw new Error("Not logged in");
      const rt = await generateRichText(text, agent);
      if (rt.graphemeLength > MAX_LENGTH) {
        Alert.alert(
          "Your post is too long",
          "There is a character limit of 300 characters",
        );
        throw new Error("Too long");
      }
      const uploadedImages = await Promise.all(
        images.map(async (img) => {
          let uri = img.asset.uri;
          const size = img.asset.fileSize ?? MAX_SIZE + 1;
          let targetWidth,
            targetHeight = MAX_DIMENSION;

          const needsResize =
            img.asset.width > MAX_DIMENSION || img.asset.height > MAX_DIMENSION;

          if (img.asset.width > img.asset.height) {
            targetHeight = img.asset.height * (MAX_DIMENSION / img.asset.width);
          } else {
            targetWidth = img.asset.width * (MAX_DIMENSION / img.asset.height);
          }

          // compress if > 1mb

          if (size > MAX_SIZE) {
            // let animation complete
            await new Promise((resolve) => setTimeout(resolve, 500));
            // compress iteratively, reducing quality each time
            for (let i = 0; i < 9; i++) {
              const quality = 100 - i * 10;

              try {
                const compressed = await ImageManipulator.manipulateAsync(
                  img.asset.uri,
                  needsResize
                    ? [{ resize: { width: targetWidth, height: targetHeight } }]
                    : [],
                  {
                    compress: quality / 100,
                  },
                ).then((x) => x.uri);
                const compressedSize = await FileSystem.getInfoAsync(
                  compressed,
                  {
                    size: true,
                  }, // @ts-expect-error size is not in the type
                ).then((x) => x.size as number);

                if (compressedSize < MAX_SIZE) {
                  uri = compressed;
                  break;
                }
              } catch (err) {
                throw new Error(`Failed to resize: ${err}`);
              }
            }
          }

          const uploaded = await agent.uploadBlob(uri);
          if (!uploaded.success) throw new Error("Failed to upload image");
          return {
            image: uploaded.data.blob,
            alt: img.alt,
          } satisfies AppBskyEmbedImages.Image;
        }),
      );
      throw new Error("Failed to upload image");

      await agent.post({
        text: rt.text,
        facets: rt.facets,
        embed:
          uploadedImages.length > 0
            ? {
                $type: "app.bsky.embed.images",
                images: uploadedImages,
              }
            : undefined,
        // TODO: LANGUAGE SELECTOR
        langs: [locale.languageCode],
      });
    },
    onMutate: () => {
      void Haptics.impactAsync();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries(["profile"]);
      router.push("../");
    },
  });

  useEffect(() => {
    navigation.getParent()?.setOptions({ gestureEnabled: isEmpty });
  }, [navigation, isEmpty]);

  return (
    <View className="flex-1" style={{ backgroundColor: theme.colors.card }}>
      <Stack.Screen
        options={{
          headerLeft: () => (
            <CancelButton
              hasContent={!isEmpty}
              onSave={() => Alert.alert("Not yet implemented")}
              disabled={send.isLoading}
            />
          ),

          headerRight: () => (
            <PostButton
              onPress={send.mutate}
              disabled={isEmpty}
              loading={send.isLoading}
            />
          ),
          headerTitleStyle: { color: "transparent" },
        }}
      />
      {send.isError && (
        <View className="bg-red-500 px-4 py-3">
          <Text className="text-xl font-medium text-white">
            {send.error instanceof Error
              ? send.error.message
              : "An unknown error occurred"}
          </Text>
          <Text className="text-white/90">Please try again</Text>
        </View>
      )}
      <ScrollView>
        <View className="w-full flex-row px-2 pt-4">
          <View className="shrink-0 px-2">
            <Avatar />
          </View>
          <View className="flex flex-1 items-start px-2">
            <View className="min-h-[48px] flex-1 flex-row items-center">
              <TextInput
                ref={textRef}
                onChange={(evt) => {
                  setText(evt.nativeEvent.text);
                  if (send.isError) {
                    send.reset();
                  }
                }}
                multiline
                className="relative -top-px w-full text-lg leading-5"
                placeholder="What's on your mind?"
                placeholderTextColor={theme.dark ? "#555" : "#aaa"}
                verticalAlign="middle"
                textAlignVertical="center"
              >
                <RichText
                  size="lg"
                  text={rt.data?.text ?? text}
                  facets={rt.data?.facets}
                  truncate={false}
                  disableLinks
                />
              </TextInput>
            </View>
            <View className="w-full flex-row items-end justify-between">
              <TouchableOpacity
                className="mt-4 flex-row items-center"
                hitSlop={8}
                onPress={() => imagePicker.mutate()}
              >
                <Paperclip
                  size={18}
                  className={
                    theme.dark ? "text-neutral-400" : "text-neutral-500"
                  }
                />
                {images.length > 0 && (
                  <Animated.Text
                    className="ml-2"
                    style={{ color: theme.colors.text }}
                    entering={FadeIn}
                    exiting={FadeOut}
                  >
                    {images.length} / {MAX_IMAGES} images
                  </Animated.Text>
                )}
              </TouchableOpacity>
              {(rt.data?.graphemeLength ?? 0) > MAX_LENGTH * 0.66 && (
                <Animated.Text
                  style={{
                    color: !tooLong
                      ? theme.colors.text
                      : theme.colors.notification,
                  }}
                  entering={FadeIn}
                  exiting={FadeOut}
                  className="text-right font-medium"
                >
                  {rt.data?.graphemeLength} / {MAX_LENGTH}
                </Animated.Text>
              )}
            </View>
            {images.length > 0 && (
              <Animated.ScrollView
                horizontal
                className="mt-4 flex-1 pb-2"
                entering={FadeInDown}
                exiting={FadeOutDown}
              >
                {images.map((image, i) => (
                  <Animated.View
                    key={image.asset.uri}
                    className={cx(
                      "relative overflow-hidden rounded-md",
                      i !== 3 && "mr-2",
                    )}
                    layout={Layout}
                    exiting={FadeOut}
                  >
                    <Image
                      cachePolicy="memory"
                      source={{ uri: image.asset.uri }}
                      alt={`image ${i}}`}
                      className="h-36 w-36"
                    />
                    <TouchableOpacity
                      className="absolute left-2 top-2 z-10"
                      onPress={() => {
                        void Haptics.impactAsync();
                        Alert.prompt(
                          "Add a caption",
                          undefined,
                          (alt) => {
                            if (alt !== null) {
                              addAltText(i, alt);
                            }
                          },
                          undefined,
                          image.alt,
                        );
                      }}
                    >
                      <View className="flex-row items-center rounded-full bg-black/90 px-2 py-[3px]">
                        {image.alt ? (
                          <Check size={14} color="white" />
                        ) : (
                          <Plus size={14} color="white" />
                        )}
                        <Text className="ml-1 text-xs font-bold uppercase text-white">
                          Alt
                        </Text>
                      </View>
                    </TouchableOpacity>
                    <TouchableOpacity
                      className="absolute right-2 top-2 z-10"
                      onPress={() => {
                        void Haptics.impactAsync();
                        removeImage(i);
                      }}
                    >
                      <View className="rounded-full bg-black/90 p-1">
                        <X size={14} color="white" />
                      </View>
                    </TouchableOpacity>
                    {image.alt && (
                      <View className="absolute bottom-0 left-0 right-0 z-10 bg-black/60 px-3 pb-2 pt-1">
                        <Text
                          numberOfLines={2}
                          className="text-sm leading-[18px] text-white"
                        >
                          {image.alt}
                        </Text>
                      </View>
                    )}
                  </Animated.View>
                ))}
                {images.length < MAX_IMAGES && (
                  <Animated.View layout={Layout}>
                    <TouchableOpacity
                      onPress={() => {
                        void Haptics.impactAsync();
                        imagePicker.mutate();
                      }}
                    >
                      <View className="h-36 w-36 items-center justify-center rounded border border-neutral-200 dark:border-neutral-500">
                        <Plus color={theme.colors.text} />
                        <Text
                          style={{ color: theme.colors.text }}
                          className="mt-2 text-center"
                        >
                          Add image
                        </Text>
                      </View>
                    </TouchableOpacity>
                  </Animated.View>
                )}
              </Animated.ScrollView>
            )}
          </View>
        </View>
      </ScrollView>
      <StatusBar style="light" />
    </View>
  );
}

const PostButton = ({
  onPress,
  loading,
  disabled,
}: {
  onPress: () => void;
  loading: boolean;
  disabled: boolean;
}) => {
  const theme = useTheme();

  return (
    <View className="flex-row items-center">
      <TouchableOpacity disabled={disabled} onPress={onPress}>
        <View
          className={cx(
            "relative flex-row items-center overflow-hidden rounded-full px-4 py-1",
            disabled && "opacity-50",
          )}
          style={{ backgroundColor: theme.colors.primary }}
        >
          <Text className="mr-2 text-base font-medium text-white">Post</Text>
          <Send size={12} className="text-white" />
          {loading && (
            <Animated.View
              entering={FadeIn}
              exiting={FadeOut}
              className="absolute bottom-0 left-0 right-0 top-0 items-center justify-center"
              style={{ backgroundColor: theme.colors.primary }}
            >
              <ActivityIndicator size="small" color="white" />
            </Animated.View>
          )}
        </View>
      </TouchableOpacity>
    </View>
  );
};

const CancelButton = ({
  hasContent,
  onSave,
  disabled,
}: {
  hasContent: boolean;
  onSave: () => void;
  disabled?: boolean;
}) => {
  const theme = useTheme();
  const router = useRouter();

  if (hasContent) {
    return (
      <ContextMenuButton
        isMenuPrimaryAction={true}
        accessibilityLabel="Save or discard post"
        accessibilityRole="button"
        enableContextMenu={!disabled}
        menuConfig={{
          menuTitle: "",
          menuItems: [
            {
              actionKey: "save",
              actionTitle: "Save to drafts",
              icon: {
                type: "IMAGE_SYSTEM",
                imageValue: {
                  systemName: "square.and.arrow.down",
                },
              },
            },
            {
              actionKey: "discard",
              actionTitle: "Discard post",
              icon: {
                type: "IMAGE_SYSTEM",
                imageValue: {
                  systemName: "trash",
                },
              },
              menuAttributes: ["destructive"],
            },
          ],
        }}
        onPressMenuItem={(evt) => {
          switch (evt.nativeEvent.actionKey) {
            case "save":
              onSave();
              break;
            case "discard":
              router.push("../");
              break;
          }
        }}
      >
        <TouchableOpacity>
          <Text style={{ color: theme.colors.primary }} className="text-lg">
            Cancel
          </Text>
        </TouchableOpacity>
      </ContextMenuButton>
    );
  }

  return (
    <Link href="../" asChild>
      <TouchableOpacity>
        <Text style={{ color: theme.colors.primary }} className="text-lg">
          Cancel
        </Text>
      </TouchableOpacity>
    </Link>
  );
};
