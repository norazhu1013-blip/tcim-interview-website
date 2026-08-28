import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from './App.vue'
import HomeView from './views/HomeView.vue'
import ProfileView from './views/ProfileView.vue'
import ExamView from './views/ExamView.vue'
import ScoreView from './views/ScoreView.vue'
import ReportView from './views/ReportView.vue'
import ReviewView from './views/ReviewView.vue'
import InterviewListView from './views/InterviewListView.vue'
import InterviewView from './views/InterviewView.vue'
import FeedbackView from './views/FeedbackView.vue'
import DoneView from './views/DoneView.vue'
import { cloud } from './services/cloudbase.js'
import './styles.css'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: HomeView },
    { path: '/profile', component: ProfileView },
    { path: '/exam/:sid', component: ExamView },
    { path: '/score/:sid', component: ScoreView },
    { path: '/report/:sid', component: ReportView },
    { path: '/review/:sid', component: ReviewView },
    { path: '/interviews/:sid', component: InterviewListView },
    { path: '/interview/:sid/:itemId', component: InterviewView },
    { path: '/feedback/:sid', component: FeedbackView },
    { path: '/done/:sid', component: DoneView }
  ],
  scrollBehavior: () => ({ top: 0 })
})

const app = createApp(App)
// 让任意 setup 组件都可以 inject('$cloud') 使用 CloudBase 实例。
app.provide('$cloud', cloud)
app.use(router).mount('#app')
