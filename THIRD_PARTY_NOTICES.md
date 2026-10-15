# Открытые компоненты Camkeys

Проверено по официальным источникам 13 октября 2026 года.

| Компонент                                            | Версия             | Использование                                      | Лицензия                                                                                                                                                                |
| ---------------------------------------------------- | ------------------ | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| @mediapipe/tasks-vision                              | 0.10.32            | Локальное распознавание рук, WASM CPU              | Apache-2.0, [LICENSE](https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE)                                                                                  |
| Hand Landmarker full, float16, version 1             | официальный bundle | Предобученные palm detector + landmarks model      | Apache-2.0 по [model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Hand%20Tracking%20%28Lite_Full%29%20with%20Fairness%20Oct%202021.pdf), стр. 2 |
| @tensorflow/tfjs-core, tfjs-layers, tfjs-backend-cpu | 4.22.0             | Персональная Conv1D, обучение и inference в worker | Apache-2.0, [LICENSE](https://github.com/tensorflow/tfjs/blob/master/LICENSE)                                                                                           |
| Vite                                                 | 7.3.7              | Только сборка и локальный dev server               | MIT, [LICENSE](https://github.com/vitejs/vite/blob/main/LICENSE)                                                                                                        |
| Playwright                                           | 1.58.2             | Только браузерные проверки                         | Apache-2.0, [LICENSE](https://github.com/microsoft/playwright/blob/main/LICENSE)                                                                                        |

Ограниченный резервный словарь и короткие контекстные пары написаны для прототипа. Основной русский словарь — `public/dictionaries/ru_50k.txt`, Hermit Dave / FrequencyWords, OpenSubtitles 2018: https://github.com/hermitdave/FrequencyWords/blob/master/content/2018/ru/ru_50k.txt . Данные распространяются по CC BY-SA 4.0: https://creativecommons.org/licenses/by-sa/4.0/ . Исходный файл сохранён без изменений; при загрузке отбираются кириллические слова длиной 1–32 буквы (48 249 уникальных слов). Источник, атрибуция и SHA-256 находятся в `public/dictionaries/README.md`. Jev, Decider и генеративные текстовые модели не используются.

`npm run assets` копирует MediaPipe WASM и библиотеку из установленного npm-пакета, скачивает модель по versioned URL Google и сохраняет оригинальные лицензионные тексты в `public/licenses/`, доступные также в dist. SHA-256 bundle: `fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1`, размер 7 819 105 байт. `public/models/source.json` фиксирует источник и фактический hash.

Документация реализации:

- [MediaPipe Web](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js): VIDEO, две руки, 21 landmark на руку, синхронный inference вынесен в classic worker.
- [MediaPipe overview](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker): pretrained bundle и выходные координаты.
- [TensorFlow.js layers](https://www.tensorflow.org/js/guide/models_and_layers): Conv1D, последовательная модель, обучение локально.

Сторонние компоненты сохраняют свои лицензии и авторство. Это локальный исследовательский прототип.

Английский словарь: Hermit Dave / FrequencyWords, OpenSubtitles 2018, CC BY-SA 4.0, https://github.com/hermitdave/FrequencyWords/blob/master/content/2018/en/en_50k.txt . Оригинальный файл сохранён без изменений; фильтрация и общий список английских сокращений применяются при загрузке. Атрибуция, описание обработки и SHA-256 находятся в public/dictionaries/README.md.
