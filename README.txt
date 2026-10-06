school-library/
├── server.py                 # Flask сервер
├── requirements.txt          # зависимости для пайтона
├── users.txt                 # аккаунты: "Логин - Пароль"
├── .secret_key               # ключ сессий
├── standalone.html           # Визуал для тестов
│
├── lib/                      # Папка для произведений (.txt / .docx / .md)
│   ├── Пушкин - Евгений Онегин (1833).txt
│   └── ...
│
├── background/               # Папка для фонов (.jpg/.png/.webp)
│   ├── bg1.jpg
│   └── ...
│
├── userdata/                 # Датафайлы пользователей
│   └── ivan.json
│
├── templates/
│   └── index.html            # основная страница
│
└── static/                   # Визуал
    ├── css/style.css
    └── js/app.js