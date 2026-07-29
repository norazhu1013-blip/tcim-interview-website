import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from './App.vue'
import HomeView from './views/HomeView.vue'
import ProfileView from './views/ProfileView.vue'
import ExamView from './views/ExamView.vue'
import ScoreView from './views/ScoreView.vue'
import ReviewView from './views/ReviewView.vue'
import InterviewListView from './views/InterviewListView.vue'
import InterviewView from './views/InterviewView.vue'
import FeedbackView from './views/FeedbackView.vue'
import DoneView from './views/DoneView.vue'
import './styles.css'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: HomeView },
    { path: '/profile', component: ProfileView },
    { path: '/exam/:sid', component: ExamView },
    { path: '/score/:sid', component: ScoreView },
    { path: '/review/:sid', component: ReviewView },
    { path: '/interviews/:sid', component: InterviewListView },
    { path: '/interview/:sid/:itemId', component: InterviewView },
    { path: '/feedback/:sid', component: FeedbackView },
    { path: '/done/:sid', component: DoneView }
  ],
  scrollBehavior: () => ({ top: 0 })
})

createApp(App).use(router).mount('#app')
