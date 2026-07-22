# Chalon dans la Rue 2026 - Mon Parcours

Une application web simple et interactive (Single Page Application) conçue pour aider les festivaliers à créer leur parcours idéal pour l'édition 2026 du festival **Chalon dans la Rue**.

🔗 **[Accéder au site](https://justjerem.github.io/site-cdlr/)**

## Fonctionnalités

L'application est divisée en 3 étapes :
1. **Découvrir** : Une interface de type "Tinder" pour découvrir la programmation, voir les spectacles et sélectionner ceux qui vous intéressent (Absolument, Ça m'intéresse, Peut-être, Pas pour moi).
2. **Mes envies** : Un récapitulatif de votre sélection avec la possibilité de filtrer et de visualiser rapidement les compagnies retenues.
3. **Mon planning** : Un calendrier interactif qui génère votre planning personnalisé en fonction de vos envies, des horaires et des lieux de représentation, en prenant en compte les temps de trajet à pied.

## Structure du projet

Ce projet est 100% statique et ne nécessite aucun serveur pour fonctionner.

- `index.html` : L'interface utilisateur, la structure de la page et le style (CSS intégré).
- `app.js` : La logique applicative (filtres, swipe, génération du calendrier, interactions).
- `data.js` : La base de données locale contenant l'intégralité du programme du festival.

## Hébergement et Déploiement

Le site est hébergé gratuitement via **GitHub Pages**.

Pour mettre à jour le site :
1. Modifiez les fichiers en local (ex: mise à jour de `data.js` avec de nouveaux horaires).
2. Envoyez les modifications sur GitHub :
   ```bash
   git add .
   git commit -m "Mise à jour du site"
   git push
   ```
3. GitHub Pages redéploiera automatiquement le site en quelques minutes.
