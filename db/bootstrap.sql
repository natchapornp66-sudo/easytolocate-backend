--
-- PostgreSQL database dump
--

\restrict bwG6NivLo1yXPfIdYuE26nWTtTd1MAyNlxtykrDkBIxcs6k4KX9w81nBcBC68eY

-- Dumped from database version 18.1
-- Dumped by pg_dump version 18.1

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: agreements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agreements (
    agreement_id uuid DEFAULT gen_random_uuid() NOT NULL,
    rental_id uuid NOT NULL,
    contract_terms text NOT NULL,
    borrower_accepted boolean DEFAULT false NOT NULL,
    lender_accepted boolean DEFAULT false NOT NULL,
    accepted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    borrower_accepted_at timestamp with time zone,
    lender_accepted_at timestamp with time zone
);


--
-- Name: categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.categories (
    category_id integer NOT NULL,
    category_name character varying(100) NOT NULL,
    description text
);


--
-- Name: categories_category_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.categories_category_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: categories_category_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.categories_category_id_seq OWNED BY public.categories.category_id;


--
-- Name: chat_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_messages (
    message_id uuid DEFAULT gen_random_uuid() NOT NULL,
    sender_id uuid NOT NULL,
    receiver_id uuid NOT NULL,
    rental_id uuid,
    message text NOT NULL,
    is_read boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: dispute_evidence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dispute_evidence (
    evidence_id uuid DEFAULT gen_random_uuid() NOT NULL,
    dispute_id uuid NOT NULL,
    uploaded_by uuid NOT NULL,
    file_path text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: dispute_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dispute_history (
    history_id uuid DEFAULT gen_random_uuid() NOT NULL,
    dispute_id uuid NOT NULL,
    action_by uuid NOT NULL,
    action_type character varying(50) NOT NULL,
    old_status character varying(50),
    new_status character varying(50),
    details text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: dispute_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dispute_messages (
    message_id uuid DEFAULT gen_random_uuid() NOT NULL,
    dispute_id uuid NOT NULL,
    sender_id uuid NOT NULL,
    message text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT dispute_messages_message_length_check CHECK (((char_length(btrim(message)) >= 10) AND (char_length(btrim(message)) <= 3000)))
);


--
-- Name: disputes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.disputes (
    dispute_id uuid DEFAULT gen_random_uuid() NOT NULL,
    rental_id uuid,
    reported_by uuid,
    reason text NOT NULL,
    status character varying(50) DEFAULT 'open'::character varying,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    category character varying(50),
    decision character varying(50),
    decision_reason text,
    adjusted_fine_amount numeric(10,2),
    resolved_by uuid,
    resolved_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: fine_refunds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fine_refunds (
    refund_id uuid DEFAULT gen_random_uuid() NOT NULL,
    dispute_id uuid NOT NULL,
    rental_id uuid NOT NULL,
    original_payment_id uuid NOT NULL,
    original_fine_amount numeric(10,2) NOT NULL,
    adjusted_fine_amount numeric(10,2) NOT NULL,
    refund_amount numeric(10,2) NOT NULL,
    status character varying(30) DEFAULT 'pending'::character varying NOT NULL,
    refund_reference text,
    refund_note text,
    processed_by uuid,
    processed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT fine_refunds_amount_positive CHECK ((refund_amount > (0)::numeric)),
    CONSTRAINT fine_refunds_amount_valid CHECK (((original_fine_amount >= adjusted_fine_amount) AND (adjusted_fine_amount >= (0)::numeric) AND (refund_amount = (original_fine_amount - adjusted_fine_amount)))),
    CONSTRAINT fine_refunds_status_valid CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'completed'::character varying, 'cancelled'::character varying])::text[])))
);


--
-- Name: item_price_benchmarks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item_price_benchmarks (
    benchmark_id integer NOT NULL,
    item_id uuid NOT NULL,
    recommended_min_price numeric(10,2),
    recommended_max_price numeric(10,2),
    sample_count integer DEFAULT 0,
    research_note text,
    researched_at timestamp with time zone DEFAULT now(),
    benchmark_status character varying(30) DEFAULT 'AVAILABLE'::character varying,
    CONSTRAINT chk_price_range CHECK (((recommended_min_price >= (0)::numeric) AND (recommended_max_price >= recommended_min_price)))
);


--
-- Name: item_price_benchmarks_benchmark_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.item_price_benchmarks_benchmark_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: item_price_benchmarks_benchmark_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.item_price_benchmarks_benchmark_id_seq OWNED BY public.item_price_benchmarks.benchmark_id;


--
-- Name: item_price_sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item_price_sources (
    source_id integer NOT NULL,
    item_id uuid NOT NULL,
    source_name text NOT NULL,
    source_url text,
    observed_rental_price numeric(10,2),
    rental_days integer,
    comparable_type character varying(30) NOT NULL,
    research_note text,
    researched_at timestamp with time zone DEFAULT now()
);


--
-- Name: item_price_sources_source_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.item_price_sources_source_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: item_price_sources_source_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.item_price_sources_source_id_seq OWNED BY public.item_price_sources.source_id;


--
-- Name: items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.items (
    item_id uuid DEFAULT gen_random_uuid() NOT NULL,
    lender_id uuid,
    category_id integer,
    title character varying(255) NOT NULL,
    description text,
    conditions text,
    daily_price numeric(10,2) NOT NULL,
    images jsonb,
    status character varying(50) DEFAULT 'available'::character varying,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    rental_conditions text,
    deposit_amount numeric(10,2) DEFAULT 0.00,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    latitude numeric(10,8) DEFAULT 16.7313,
    longitude numeric(11,8) DEFAULT 100.1979,
    search_keywords text,
    clothing_size character varying(20),
    chest numeric(6,2),
    waist numeric(6,2),
    hips numeric(6,2),
    clothing_length numeric(6,2),
    CONSTRAINT chk_item_status CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'hidden'::character varying, 'banned'::character varying, 'inactive'::character varying])::text[])))
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    notification_id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    title character varying(150) NOT NULL,
    message text NOT NULL,
    type character varying(50) NOT NULL,
    is_read boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: rental_inspections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rental_inspections (
    inspection_id uuid DEFAULT gen_random_uuid() NOT NULL,
    rental_id uuid,
    inspector_id uuid,
    inspection_type character varying(50),
    condition_notes text,
    photo_urls jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_inspection_type CHECK (((inspection_type)::text = ANY ((ARRAY['lender_before'::character varying, 'borrower_before'::character varying, 'borrower_after'::character varying])::text[])))
);


--
-- Name: rental_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rental_payments (
    payment_id uuid DEFAULT gen_random_uuid() NOT NULL,
    rental_id uuid NOT NULL,
    payment_type character varying(20) NOT NULL,
    amount numeric(12,2) NOT NULL,
    bank_account_id uuid,
    slip_url text NOT NULL,
    status character varying(30) DEFAULT 'submitted'::character varying NOT NULL,
    submitted_by uuid NOT NULL,
    verified_by uuid,
    verified_at timestamp with time zone,
    rejection_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT rental_payments_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT rental_payments_payment_type_check CHECK (((payment_type)::text = ANY ((ARRAY['rental'::character varying, 'fine'::character varying])::text[]))),
    CONSTRAINT rental_payments_status_check CHECK (((status)::text = ANY ((ARRAY['submitted'::character varying, 'verified'::character varying, 'rejected'::character varying])::text[])))
);


--
-- Name: rentals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rentals (
    rental_id uuid DEFAULT gen_random_uuid() NOT NULL,
    item_id uuid,
    borrower_id uuid,
    start_date date NOT NULL,
    end_date date NOT NULL,
    total_days integer NOT NULL,
    total_price numeric(10,2) NOT NULL,
    status character varying(50) DEFAULT 'pending'::character varying,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    fine_amount numeric(10,2) DEFAULT 0 NOT NULL,
    fine_reason text,
    fine_status character varying(30) DEFAULT 'none'::character varying NOT NULL,
    payment_status character varying(30) DEFAULT 'pending'::character varying NOT NULL,
    received_confirmed_at timestamp with time zone,
    CONSTRAINT chk_rental_status CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'approved'::character varying, 'borrowing'::character varying, 'return_requested'::character varying, 'inspection_pending'::character varying, 'fine_pending'::character varying, 'completed'::character varying, 'damaged'::character varying, 'rejected'::character varying])::text[])))
);


--
-- Name: reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reviews (
    review_id uuid DEFAULT gen_random_uuid() NOT NULL,
    rental_id uuid,
    reviewer_id uuid,
    rating integer,
    comment text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    reviewee_id uuid,
    photo_urls jsonb DEFAULT '[]'::jsonb,
    CONSTRAINT reviews_rating_check CHECK (((rating >= 1) AND (rating <= 5)))
);


--
-- Name: user_bank_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_bank_accounts (
    bank_account_id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    bank_name character varying(100) NOT NULL,
    account_name character varying(150) NOT NULL,
    account_number character varying(30) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_verifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_verifications (
    verification_id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    id_card_number character varying(20) NOT NULL,
    id_card_image_url character varying(255) NOT NULL,
    selfie_image_url character varying(255) NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    verified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_verification_status CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'approved'::character varying, 'rejected'::character varying])::text[])))
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    user_id uuid DEFAULT gen_random_uuid() NOT NULL,
    email character varying(255) NOT NULL,
    full_name character varying(255) NOT NULL,
    phone_number character varying(50),
    password_hash character varying(255) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    trust_score numeric(3,2) DEFAULT 0.00,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    role character varying(20) DEFAULT 'user'::character varying NOT NULL,
    CONSTRAINT chk_user_status CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'suspended'::character varying, 'banned'::character varying])::text[])))
);


--
-- Name: categories category_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories ALTER COLUMN category_id SET DEFAULT nextval('public.categories_category_id_seq'::regclass);


--
-- Name: item_price_benchmarks benchmark_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_price_benchmarks ALTER COLUMN benchmark_id SET DEFAULT nextval('public.item_price_benchmarks_benchmark_id_seq'::regclass);


--
-- Name: item_price_sources source_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_price_sources ALTER COLUMN source_id SET DEFAULT nextval('public.item_price_sources_source_id_seq'::regclass);


--
-- Name: agreements agreements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agreements
    ADD CONSTRAINT agreements_pkey PRIMARY KEY (agreement_id);


--
-- Name: agreements agreements_rental_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agreements
    ADD CONSTRAINT agreements_rental_id_key UNIQUE (rental_id);


--
-- Name: categories categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (category_id);


--
-- Name: chat_messages chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (message_id);


--
-- Name: dispute_evidence dispute_evidence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispute_evidence
    ADD CONSTRAINT dispute_evidence_pkey PRIMARY KEY (evidence_id);


--
-- Name: dispute_history dispute_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispute_history
    ADD CONSTRAINT dispute_history_pkey PRIMARY KEY (history_id);


--
-- Name: dispute_messages dispute_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispute_messages
    ADD CONSTRAINT dispute_messages_pkey PRIMARY KEY (message_id);


--
-- Name: disputes disputes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disputes
    ADD CONSTRAINT disputes_pkey PRIMARY KEY (dispute_id);


--
-- Name: fine_refunds fine_refunds_dispute_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fine_refunds
    ADD CONSTRAINT fine_refunds_dispute_unique UNIQUE (dispute_id);


--
-- Name: fine_refunds fine_refunds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fine_refunds
    ADD CONSTRAINT fine_refunds_pkey PRIMARY KEY (refund_id);


--
-- Name: item_price_benchmarks item_price_benchmarks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_price_benchmarks
    ADD CONSTRAINT item_price_benchmarks_pkey PRIMARY KEY (benchmark_id);


--
-- Name: item_price_sources item_price_sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_price_sources
    ADD CONSTRAINT item_price_sources_pkey PRIMARY KEY (source_id);


--
-- Name: items items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT items_pkey PRIMARY KEY (item_id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (notification_id);


--
-- Name: rental_inspections rental_inspections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rental_inspections
    ADD CONSTRAINT rental_inspections_pkey PRIMARY KEY (inspection_id);


--
-- Name: rental_payments rental_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rental_payments
    ADD CONSTRAINT rental_payments_pkey PRIMARY KEY (payment_id);


--
-- Name: rentals rentals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rentals
    ADD CONSTRAINT rentals_pkey PRIMARY KEY (rental_id);


--
-- Name: reviews reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_pkey PRIMARY KEY (review_id);


--
-- Name: user_bank_accounts user_bank_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_bank_accounts
    ADD CONSTRAINT user_bank_accounts_pkey PRIMARY KEY (bank_account_id);


--
-- Name: user_bank_accounts user_bank_accounts_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_bank_accounts
    ADD CONSTRAINT user_bank_accounts_user_id_key UNIQUE (user_id);


--
-- Name: user_verifications user_verifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_verifications
    ADD CONSTRAINT user_verifications_pkey PRIMARY KEY (verification_id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (user_id);


--
-- Name: idx_chat_conversation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_conversation ON public.chat_messages USING btree (sender_id, receiver_id);


--
-- Name: idx_dispute_messages_dispute_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dispute_messages_dispute_created ON public.dispute_messages USING btree (dispute_id, created_at);


--
-- Name: idx_disputes_one_open_per_rental; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_disputes_one_open_per_rental ON public.disputes USING btree (rental_id) WHERE ((status)::text = 'open'::text);


--
-- Name: idx_item_price_benchmarks_item; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_item_price_benchmarks_item ON public.item_price_benchmarks USING btree (item_id);


--
-- Name: idx_rental_payments_rental_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rental_payments_rental_id ON public.rental_payments USING btree (rental_id);


--
-- Name: idx_rental_payments_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rental_payments_status ON public.rental_payments USING btree (status);


--
-- Name: idx_user_bank_accounts_user_id_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_user_bank_accounts_user_id_unique ON public.user_bank_accounts USING btree (user_id);


--
-- Name: uq_reviews_rental_reviewer; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_reviews_rental_reviewer ON public.reviews USING btree (rental_id, reviewer_id);


--
-- Name: dispute_evidence dispute_evidence_dispute_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispute_evidence
    ADD CONSTRAINT dispute_evidence_dispute_id_fkey FOREIGN KEY (dispute_id) REFERENCES public.disputes(dispute_id);


--
-- Name: dispute_evidence dispute_evidence_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispute_evidence
    ADD CONSTRAINT dispute_evidence_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(user_id);


--
-- Name: dispute_history dispute_history_action_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispute_history
    ADD CONSTRAINT dispute_history_action_by_fkey FOREIGN KEY (action_by) REFERENCES public.users(user_id);


--
-- Name: dispute_history dispute_history_dispute_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispute_history
    ADD CONSTRAINT dispute_history_dispute_id_fkey FOREIGN KEY (dispute_id) REFERENCES public.disputes(dispute_id);


--
-- Name: dispute_messages dispute_messages_dispute_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispute_messages
    ADD CONSTRAINT dispute_messages_dispute_id_fkey FOREIGN KEY (dispute_id) REFERENCES public.disputes(dispute_id) ON DELETE RESTRICT;


--
-- Name: dispute_messages dispute_messages_sender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispute_messages
    ADD CONSTRAINT dispute_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.users(user_id) ON DELETE RESTRICT;


--
-- Name: disputes disputes_rental_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disputes
    ADD CONSTRAINT disputes_rental_id_fkey FOREIGN KEY (rental_id) REFERENCES public.rentals(rental_id) ON DELETE CASCADE;


--
-- Name: disputes disputes_reported_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disputes
    ADD CONSTRAINT disputes_reported_by_fkey FOREIGN KEY (reported_by) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: fine_refunds fine_refunds_dispute_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fine_refunds
    ADD CONSTRAINT fine_refunds_dispute_id_fkey FOREIGN KEY (dispute_id) REFERENCES public.disputes(dispute_id);


--
-- Name: fine_refunds fine_refunds_original_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fine_refunds
    ADD CONSTRAINT fine_refunds_original_payment_id_fkey FOREIGN KEY (original_payment_id) REFERENCES public.rental_payments(payment_id);


--
-- Name: fine_refunds fine_refunds_processed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fine_refunds
    ADD CONSTRAINT fine_refunds_processed_by_fkey FOREIGN KEY (processed_by) REFERENCES public.users(user_id);


--
-- Name: fine_refunds fine_refunds_rental_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fine_refunds
    ADD CONSTRAINT fine_refunds_rental_id_fkey FOREIGN KEY (rental_id) REFERENCES public.rentals(rental_id);


--
-- Name: agreements fk_agreements_rental; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agreements
    ADD CONSTRAINT fk_agreements_rental FOREIGN KEY (rental_id) REFERENCES public.rentals(rental_id) ON DELETE CASCADE;


--
-- Name: chat_messages fk_chat_receiver; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT fk_chat_receiver FOREIGN KEY (receiver_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: chat_messages fk_chat_rental; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT fk_chat_rental FOREIGN KEY (rental_id) REFERENCES public.rentals(rental_id) ON DELETE SET NULL;


--
-- Name: chat_messages fk_chat_sender; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT fk_chat_sender FOREIGN KEY (sender_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: notifications fk_notifications_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: reviews fk_reviews_reviewee; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT fk_reviews_reviewee FOREIGN KEY (reviewee_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: user_verifications fk_verifications_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_verifications
    ADD CONSTRAINT fk_verifications_user FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: item_price_benchmarks item_price_benchmarks_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_price_benchmarks
    ADD CONSTRAINT item_price_benchmarks_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(item_id) ON DELETE CASCADE;


--
-- Name: item_price_sources item_price_sources_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_price_sources
    ADD CONSTRAINT item_price_sources_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(item_id) ON DELETE CASCADE;


--
-- Name: items items_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT items_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(category_id) ON DELETE SET NULL;


--
-- Name: items items_lender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT items_lender_id_fkey FOREIGN KEY (lender_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: rental_inspections rental_inspections_inspector_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rental_inspections
    ADD CONSTRAINT rental_inspections_inspector_id_fkey FOREIGN KEY (inspector_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: rental_inspections rental_inspections_rental_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rental_inspections
    ADD CONSTRAINT rental_inspections_rental_id_fkey FOREIGN KEY (rental_id) REFERENCES public.rentals(rental_id) ON DELETE CASCADE;


--
-- Name: rental_payments rental_payments_bank_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rental_payments
    ADD CONSTRAINT rental_payments_bank_account_id_fkey FOREIGN KEY (bank_account_id) REFERENCES public.user_bank_accounts(bank_account_id);


--
-- Name: rental_payments rental_payments_rental_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rental_payments
    ADD CONSTRAINT rental_payments_rental_id_fkey FOREIGN KEY (rental_id) REFERENCES public.rentals(rental_id);


--
-- Name: rental_payments rental_payments_submitted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rental_payments
    ADD CONSTRAINT rental_payments_submitted_by_fkey FOREIGN KEY (submitted_by) REFERENCES public.users(user_id);


--
-- Name: rental_payments rental_payments_verified_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rental_payments
    ADD CONSTRAINT rental_payments_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES public.users(user_id);


--
-- Name: rentals rentals_borrower_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rentals
    ADD CONSTRAINT rentals_borrower_id_fkey FOREIGN KEY (borrower_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: rentals rentals_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rentals
    ADD CONSTRAINT rentals_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(item_id) ON DELETE CASCADE;


--
-- Name: reviews reviews_rental_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_rental_id_fkey FOREIGN KEY (rental_id) REFERENCES public.rentals(rental_id) ON DELETE CASCADE;


--
-- Name: reviews reviews_reviewer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: user_bank_accounts user_bank_accounts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_bank_accounts
    ADD CONSTRAINT user_bank_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id);


--
-- PostgreSQL database dump complete
--

\unrestrict bwG6NivLo1yXPfIdYuE26nWTtTd1MAyNlxtykrDkBIxcs6k4KX9w81nBcBC68eY


-- Application category reference data only; no accounts, documents or transactions.
INSERT INTO public.categories (category_id,category_name) VALUES (1,'กล้องและอุปกรณ์ถ่ายภาพ');
INSERT INTO public.categories (category_id,category_name) VALUES (2,'อุปกรณ์แคมป์ปิ้ง');
INSERT INTO public.categories (category_id,category_name) VALUES (3,'เครื่องใช้ไฟฟ้าและเกม');
INSERT INTO public.categories (category_id,category_name) VALUES (4,'เสื้อผ้าและแฟชั่น');
INSERT INTO public.categories (category_id,category_name) VALUES (5,'เครื่องดนตรี');
INSERT INTO public.categories (category_id,category_name) VALUES (6,'กระเป๋าและแบรนด์เนม');
INSERT INTO public.categories (category_id,category_name) VALUES (7,'ยานพาหนะและสกู๊ตเตอร์');
INSERT INTO public.categories (category_id,category_name) VALUES (8,'อุปกรณ์กีฬาและออกกำลังกาย');
INSERT INTO public.categories (category_id,category_name) VALUES (9,'ของแต่งบ้านและอีเวนต์');
INSERT INTO public.categories (category_id,category_name) VALUES (10,'เครื่องมือช่างและ DIY');
INSERT INTO public.categories (category_id,category_name) VALUES (11,'หนังสือและสื่อความรู้');
INSERT INTO public.categories (category_id,category_name) VALUES (12,'อุปกรณ์เด็กและแม่');
INSERT INTO public.categories (category_id,category_name) VALUES (13,'ของสะสมและโมเดล');
SELECT setval('public.categories_category_id_seq', COALESCE((SELECT MAX(category_id) FROM public.categories), 1), true);
