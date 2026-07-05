# Image-based questions using free Wikimedia Commons URLs.
# Each question: {"q": text, "opts": [4], "a": index, "img": url}

IMAGE_QUESTIONS = {
    "capitals": [
        {"q": "أي مدينة معلمها الشهير هذا؟", "opts": ["باريس", "لندن", "روما", "برلين"], "a": 0,
         "img": "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a8/Tour_Eiffel_Wikimedia_Commons.jpg/320px-Tour_Eiffel_Wikimedia_Commons.jpg"},
        {"q": "ما اسم هذا المعلم الأثري؟", "opts": ["أهرامات الجيزة", "معبد الأقصر", "أبو الهول", "قلعة صلاح الدين"], "a": 0,
         "img": "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e3/Kheops-Pyramid.jpg/320px-Kheops-Pyramid.jpg"},
        {"q": "أي مدينة هذا المعلم الديني؟", "opts": ["المدينة", "مكة", "القدس", "بغداد"], "a": 1,
         "img": "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/Kaaba_Masjid_Haraam_Mecca.jpg/320px-Kaaba_Masjid_Haraam_Mecca.jpg"},
        {"q": "ما هذا المعلم؟", "opts": ["سور الصين العظيم", "سور برلين", "سور بابل", "سور طروادة"], "a": 0,
         "img": "https://upload.wikimedia.org/wikipedia/commons/thumb/1/17/The_Great_Wall_of_China_at_Jinshanling-edit.jpg/320px-The_Great_Wall_of_China_at_Jinshanling-edit.jpg"},
        {"q": "في أي دولة يقع تاج محل؟", "opts": ["باكستان", "الهند", "بنغلاديش", "إيران"], "a": 1,
         "img": "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1d/Taj_Mahal_%28Edited%29.jpeg/320px-Taj_Mahal_%28Edited%29.jpeg"},
        {"q": "أي مدينة يقع فيها الكولوسيوم؟", "opts": ["أثينا", "روما", "إسطنبول", "الإسكندرية"], "a": 1,
         "img": "https://upload.wikimedia.org/wikipedia/commons/thumb/d/de/Colosseo_2020.jpg/320px-Colosseo_2020.jpg"},
    ],
    "celebs": [
        {"q": "من هذه المطربة العربية؟", "opts": ["فيروز", "أم كلثوم", "وردة", "أسمهان"], "a": 1,
         "img": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/45/OumKalsoumBW.jpg/320px-OumKalsoumBW.jpg"},
        {"q": "من هذا الأديب الحائز على نوبل؟", "opts": ["طه حسين", "نجيب محفوظ", "توفيق الحكيم", "المنفلوطي"], "a": 1,
         "img": "https://upload.wikimedia.org/wikipedia/commons/thumb/7/74/Naguib_Mahfouz_1988.jpg/320px-Naguib_Mahfouz_1988.jpg"},
        {"q": "من هو هذا العالم؟", "opts": ["نيوتن", "آينشتاين", "غاليليو", "هوكينج"], "a": 1,
         "img": "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d3/Albert_Einstein_Head.jpg/320px-Albert_Einstein_Head.jpg"},
    ],
    "animals": [
        {"q": "ما اسم هذا الحيوان؟", "opts": ["الفهد", "النمر", "الأسد", "الجاغور"], "a": 0,
         "img": "https://upload.wikimedia.org/wikipedia/commons/thumb/1/17/Charging_Cheetah.jpg/320px-Charging_Cheetah.jpg"},
        {"q": "ما هذا الحيوان؟", "opts": ["حصان البحر", "الأخطبوط", "الحبار", "قنديل البحر"], "a": 1,
         "img": "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9e/Common_Octopus.jpg/320px-Common_Octopus.jpg"},
        {"q": "ما اسم هذا الطائر؟", "opts": ["البطريق", "النعامة", "الطاووس", "الحمام"], "a": 0,
         "img": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4d/Pygoscelis_papua.jpg/320px-Pygoscelis_papua.jpg"},
    ],
    "space": [
        {"q": "ما اسم هذا الكوكب؟", "opts": ["الزهرة", "المريخ", "المشتري", "زحل"], "a": 3,
         "img": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c7/Saturn_during_Equinox.jpg/320px-Saturn_during_Equinox.jpg"},
        {"q": "أي كوكب هذا؟", "opts": ["الأرض", "المريخ", "الزهرة", "المشتري"], "a": 1,
         "img": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/02/OSIRIS_Mars_true_color.jpg/320px-OSIRIS_Mars_true_color.jpg"},
        {"q": "ما هذا الجرم السماوي؟", "opts": ["مذنب", "قمر الأرض", "كوكب صغير", "كويكب"], "a": 1,
         "img": "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e1/FullMoon2010.jpg/320px-FullMoon2010.jpg"},
    ],
    "geography": [
        {"q": "أي جبل هذا؟", "opts": ["كليمنجارو", "إفرست", "K2", "مونت بلانك"], "a": 1,
         "img": "https://upload.wikimedia.org/wikipedia/commons/thumb/2/23/Everest_from_Kalapatthar.jpg/320px-Everest_from_Kalapatthar.jpg"},
        {"q": "أي محيط أو بحر هذا الشاطئ؟", "opts": ["البحر الأحمر", "المحيط الهادي", "المتوسط", "البحر الميت"], "a": 3,
         "img": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/48/Dead_sea_newspaper.jpg/320px-Dead_sea_newspaper.jpg"},
    ],
}
