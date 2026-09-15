import { useEffect,useState } from "react";
import { ArrowLeft,ArrowRight,CalendarDays,Clock,FileText,Stethoscope } from "lucide-react";
import { Link,useParams } from "react-router-dom";
import { publicApi } from "../../api/publicApi";
import { useI18n } from "../../i18n/I18nContext";
import SEOMeta,{buildBreadcrumbJsonLd} from "../../components/shared/SEOMeta";
import { buildPublicUrl } from "../../config/seo";
import PublicPageFrame,{PublicCard} from "../../components/public/PublicPageFrame";
export default function ArticleDetail(){const {slug}=useParams(),{t,locale}=useI18n(),[data,setData]=useState(null),[state,setState]=useState("loading");const load=()=>{setState("loading");publicApi.getArticle(slug).then(r=>{setData(r.data||null);setState(r.data?.article?"ready":"error")}).catch(()=>setState("error"))};useEffect(load,[slug,locale]);if(state==="loading")return <PublicPageFrame><div className="public-shell py-24"><div className="h-96 animate-pulse rounded-3xl bg-slate-100"/></div></PublicPageFrame>;if(state==="error"||!data?.article)return <PublicPageFrame><div className="public-shell py-28 text-center"><FileText size={38} className="mx-auto"/><h1 className="mt-4 text-2xl font-black">{t("p19.articles.empty")}</h1><Link to="/articles" className="mt-5 inline-flex rounded-xl bg-orange-500 px-4 py-3 text-sm font-black">{t("p19.articles.title")}</Link></div></PublicPageFrame>;const a=data.article;return <PublicPageFrame><SEOMeta
      title={a.seo?.title||a.title}
      description={a.seo?.description||a.excerpt}
      canonical={a.seo?.canonical||`/articles/${a.slug}`}
      image={a.bannerImage||undefined}
      imageAlt={a.title}
      locale={locale}
      robots={a.seo?.robots}
      type="article"
      jsonLd={[
        {"@type":"Article",headline:a.title,description:a.excerpt||undefined,datePublished:a.publishedAt||undefined,dateModified:a.updatedAt||undefined,image:a.bannerImage||undefined,author:a.author?.name?{"@type":"Person",name:a.author.name}:undefined,mainEntityOfPage:{ "@type":"WebPage", "@id":a.seo?.canonical?.startsWith("http") ? a.seo.canonical : buildPublicUrl(`/articles/${a.slug}`) }},
        buildBreadcrumbJsonLd([
          {name:t("nav.home"),url:"/"},
          {name:t("nav.articles"),url:"/articles"},
          {name:a.title,url:`/articles/${a.slug}`},
        ]),
      ]}
    /><article className="public-shell pb-24 pt-12 lg:pt-20"><Link to="/articles" className="inline-flex items-center gap-2 text-sm font-bold text-slate-500"><ArrowLeft size={14}/>{t("p19.services.back")}</Link><header className="mt-8 max-w-5xl">{a.category&&<p className="text-xs font-black uppercase tracking-[.2em] text-orange-600">{a.category}</p>}<h1 className="mt-3 text-4xl font-black tracking-tight sm:text-6xl">{a.title}</h1><div className="mt-4 flex flex-wrap gap-4 text-xs font-bold text-slate-500"><span className="flex items-center gap-1"><CalendarDays size={13}/>{a.publishedAt?new Date(a.publishedAt).toLocaleDateString(locale==="hi"?"hi-IN":"en-IN",{day:"numeric",month:"long",year:"numeric"}):t("p19.articles.published")}</span><span className="flex items-center gap-1"><Clock size={13}/>{a.readingTime} min</span>{a.author?.name&&<span>{a.author.name}</span>}</div>{a.bannerImage&&<img src={a.bannerImage} alt={a.title} className="mt-8 h-64 w-full rounded-3xl object-cover sm:h-96"/>}</header><PublicCard className="mx-auto mt-10 max-w-3xl p-6 sm:p-10"><div className="prose max-w-none text-base leading-8 text-slate-700 sm:text-lg" dangerouslySetInnerHTML={{__html:a.content||""}} /></PublicCard>{(a.relatedServices?.length||a.relatedDoctors?.length||data.relatedArticles?.length)&&<section className="mt-12 grid gap-6 lg:grid-cols-3">{a.relatedServices?.length>0&&<PublicCard className="p-6"><h2 className="text-xl font-black">{t("p19.articles.relatedServices")}</h2><div className="mt-4 space-y-3">{a.relatedServices.map(s=><Link key={s.id} to={`/services/${s.slug}`} className="flex items-center justify-between rounded-xl bg-slate-50 p-3 text-sm font-bold">{s.title}<ArrowRight size={14}/></Link>)}</div></PublicCard>}{a.relatedDoctors?.length>0&&<PublicCard className="p-6"><h2 className="text-xl font-black">{t("p19.articles.relatedDoctors")}</h2><div className="mt-4 space-y-3">{a.relatedDoctors.map(d=><Link key={d.id} to={`/doctors/${d.id}`} className="flex items-center gap-3 rounded-xl bg-slate-50 p-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white">{d.profilePhoto?<img src={d.profilePhoto} alt="" className="h-10 w-10 rounded-xl object-cover"/>:<Stethoscope size={16}/>}</div><span><b className="block text-sm">{d.name}</b><small className="text-slate-500">{d.specialization}</small></span></Link>)}</div></PublicCard>}{data.relatedArticles?.length>0&&<PublicCard className="p-6"><h2 className="text-xl font-black">{t("p19.articles.related")}</h2><div className="mt-4 space-y-3">{data.relatedArticles.map(r=><Link key={r.id} to={`/articles/${r.slug}`} className="block rounded-xl bg-slate-50 p-3 text-sm font-bold">{r.title}</Link>)}</div></PublicCard>}</section>}</article></PublicPageFrame>}
